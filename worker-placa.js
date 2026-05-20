// ============================================================
// COLE ISSO NO SEU CLOUDFLARE WORKER (no arquivo src/index.js
// ou junto com suas rotas existentes via Hono)
// ============================================================
//
// Variáveis de ambiente necessárias no wrangler.toml ou
// via "wrangler secret put":
//   APIPLACAS_TOKEN  = seu token da apiplacas.com.br
//   KEPLACA_SECRET   = a mesma senha que você definiu no Render
//   KEPLACA_URL      = https://keplaca-scraper.onrender.com
//
// Binding D1 necessário no wrangler.toml:
//   [[d1_databases]]
//   binding = "DB"
//   database_name = "seu-banco"
//   database_id = "seu-id"
// ============================================================

import { Hono } from 'hono'

const app = new Hono()

const CACHE_TTL = 60 * 60 * 24 * 30 // 30 dias em segundos

// ─── Migration SQL — rode uma vez no D1 ──────────────────────────────────────
// CREATE TABLE IF NOT EXISTS placa_cache (
//   placa         TEXT PRIMARY KEY,
//   dados         TEXT NOT NULL,
//   fonte         TEXT NOT NULL,
//   consultado_em INTEGER NOT NULL
// );

// ─── Fonte 1: sua apiplacas.com.br ───────────────────────────────────────────
async function consultarApiPlacas(placa, token) {
  try {
    const res = await fetch(
      `https://apiplacas.com.br/api.php?placa=${placa}&token=${token}`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.MODELO && !data?.modelo) return null

    return {
      placa,
      marca:       data.MARCA       || data.marca       || '',
      modelo:      data.MODELO      || data.modelo      || '',
      ano:         data.ano         || data.anoModelo   || '',
      anoModelo:   data.anoModelo   || '',
      cor:         data.cor         || '',
      combustivel: data.extra?.combustivel || '',
      especie:     data.extra?.especie     || '',
      municipio:   data.extra?.municipio   || '',
      uf:          data.uf          || '',
      fonte:       'apiplacas'
    }
  } catch { return null }
}

// ─── Fonte 2: keplaca via Render (fallback para placas novas) ────────────────
async function consultarKeplaca(placa, env) {
  try {
    const res = await fetch(
      `${env.KEPLACA_URL}/placa/${placa}`,
      {
        headers: { 'x-api-key': env.KEPLACA_SECRET },
        signal: AbortSignal.timeout(45000) // Render free pode demorar ~50s pra acordar
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.marca && !data?.modelo) return null
    return data
  } catch { return null }
}

// ─── Rota principal de consulta de placa ─────────────────────────────────────
app.get('/placa/:placa', async (c) => {
  const placaRaw = c.req.param('placa').toUpperCase().replace(/[^A-Z0-9]/g, '')

  if (!/^[A-Z]{3}[0-9]{4}$/.test(placaRaw) && !/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placaRaw)) {
    return c.json({ erro: 'Formato de placa inválido' }, 400)
  }

  const db    = c.env.DB
  const agora = Math.floor(Date.now() / 1000)

  // 1. Verifica cache D1
  try {
    const cached = await db
      .prepare('SELECT dados, fonte, consultado_em FROM placa_cache WHERE placa = ?')
      .bind(placaRaw)
      .first()

    if (cached && agora - cached.consultado_em < CACHE_TTL) {
      return c.json({ cache: true, fonte: cached.fonte, ...JSON.parse(cached.dados) })
    }
  } catch (_) {}

  // 2. Tenta apiplacas.com.br
  let resultado = await consultarApiPlacas(placaRaw, c.env.APIPLACAS_TOKEN)

  // 3. Fallback: keplaca via Render
  if (!resultado) {
    resultado = await consultarKeplaca(placaRaw, c.env)
  }

  if (!resultado) {
    return c.json({ erro: 'Veículo não encontrado em nenhuma fonte' }, 404)
  }

  // 4. Salva no cache D1
  try {
    await db
      .prepare(`
        INSERT INTO placa_cache (placa, dados, fonte, consultado_em)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(placa) DO UPDATE
          SET dados = excluded.dados,
              fonte = excluded.fonte,
              consultado_em = excluded.consultado_em
      `)
      .bind(placaRaw, JSON.stringify(resultado), resultado.fonte, agora)
      .run()
  } catch (_) {}

  return c.json({ cache: false, ...resultado })
})

// ─── Rota de ping (chamada pelo Cron do Worker para manter Render acordado) ───
app.get('/ping-render', async (c) => {
  try {
    const res = await fetch(`${c.env.KEPLACA_URL}/health`, {
      signal: AbortSignal.timeout(10000)
    })
    return c.json({ ok: res.ok, status: res.status })
  } catch (err) {
    return c.json({ ok: false, erro: err.message }, 500)
  }
})

// ─── Cron handler — adicione no wrangler.toml: ───────────────────────────────
// [triggers]
// crons = ["*/10 * * * *"]   ← executa a cada 10 minutos
export async function scheduled(event, env, ctx) {
  try {
    await fetch(`${env.KEPLACA_URL}/health`, {
      signal: AbortSignal.timeout(10000)
    })
    console.log(`[PING] Render acordado: ${new Date().toISOString()}`)
  } catch (err) {
    console.error(`[PING] Falhou: ${err.message}`)
  }
}

export default app
