const express = require('express')
const puppeteer = require('puppeteer-core')
const chromium = require('@sparticuz/chromium')

const app = express()
const PORT = process.env.PORT || 3000
const API_SECRET = process.env.API_SECRET || 'troque-essa-chave'

// ─── Health check SEM autenticação (deve vir antes do middleware) ─────────────
app.get('/health', (req, res) => res.status(200).send('OK'))
app.get('/', (req, res) => res.json({ status: 'ok', servico: 'keplaca-scraper' }))

// ─── Middleware de autenticação (só para rotas abaixo) ────────────────────────
app.use((req, res, next) => {
  const key = req.headers['x-api-key']
  if (key !== API_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' })
  }
  next()
})

// ─── Função de scraping ───────────────────────────────────────────────────────
async function consultarKeplaca(placa) {
  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort()
      } else {
        req.continue()
      }
    })

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )

    await page.goto(
      `https://keplaca.com/placa?placa-fipe=${placa.toUpperCase()}`,
      { waitUntil: 'networkidle2', timeout: 30000 }
    )

    // Aguarda algum elemento de dados aparecer
    await page.waitForSelector('table tr, dl dt, .card', { timeout: 15000 }).catch(() => {})

    const dados = await page.evaluate(() => {
      const resultado = {}
      const mapeamento = {
        marca:       ['marca'],
        modelo:      ['modelo'],
        ano:         ['ano fabricação', 'ano fabricacao', 'ano'],
        anoModelo:   ['ano modelo', 'anomodelo'],
        cor:         ['cor'],
        combustivel: ['combustível', 'combustivel'],
        cilindrada:  ['cilindrada', 'cilindradas'],
        potencia:    ['potência', 'potencia'],
        especie:     ['espécie veículo', 'especie veiculo', 'espécie', 'especie'],
        carroceria:  ['carroceria'],
        municipio:   ['município', 'municipio'],
        uf:          ['uf'],
        chassi:      ['chassi'],
        passageiros: ['passageiros', 'capacidade passageiro'],
        importado:   ['importado'],
      }

      const pares = []

      // <table> rows
      document.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('td, th')
        if (cells.length >= 2) {
          pares.push({
            chave: cells[0].innerText.trim().toLowerCase(),
            valor: cells[1].innerText.trim()
          })
        }
      })

      // <dl><dt><dd>
      document.querySelectorAll('dt').forEach(dt => {
        const dd = dt.nextElementSibling
        if (dd && dd.tagName === 'DD') {
          pares.push({ chave: dt.innerText.trim().toLowerCase(), valor: dd.innerText.trim() })
        }
      })

      // divs/p com "Label: Valor"
      document.querySelectorAll('div, p, li, span').forEach(el => {
        const filhos = el.children
        if (filhos.length === 0) return // só folhas
        const txt = el.innerText || ''
        const match = txt.match(/^([^:\n]{2,40}):\s*(.+)$/)
        if (match) {
          pares.push({ chave: match[1].trim().toLowerCase(), valor: match[2].trim() })
        }
      })

      for (const [campo, aliases] of Object.entries(mapeamento)) {
        for (const par of pares) {
          if (aliases.some(alias => par.chave.includes(alias))) {
            if (!resultado[campo]) resultado[campo] = par.valor
          }
        }
      }

      return resultado
    })

    if (!dados.marca && !dados.modelo) return null

    return {
      placa:       placa.toUpperCase(),
      marca:       dados.marca       || '',
      modelo:      dados.modelo      || '',
      ano:         dados.ano         || '',
      anoModelo:   dados.anoModelo   || '',
      cor:         dados.cor         || '',
      combustivel: dados.combustivel || '',
      cilindrada:  dados.cilindrada  || '',
      potencia:    dados.potencia    || '',
      especie:     dados.especie     || '',
      carroceria:  dados.carroceria  || '',
      municipio:   dados.municipio   || '',
      uf:          dados.uf          || '',
      chassi:      dados.chassi      || '',
      passageiros: dados.passageiros || '',
      importado:   dados.importado   || '',
      fonte:       'keplaca'
    }
  } finally {
    if (browser) await browser.close()
  }
}

// ─── Rota de consulta ─────────────────────────────────────────────────────────
app.get('/placa/:placa', async (req, res) => {
  const placa = req.params.placa.toUpperCase().replace(/[^A-Z0-9]/g, '')

  if (!/^[A-Z]{3}[0-9]{4}$/.test(placa) && !/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placa)) {
    return res.status(400).json({ erro: 'Formato inválido. Use ABC1234 ou ABC1D23' })
  }

  try {
    console.log(`[${new Date().toISOString()}] Consultando: ${placa}`)
    const dados = await consultarKeplaca(placa)
    if (!dados) return res.status(404).json({ erro: 'Veículo não encontrado' })
    console.log(`[${new Date().toISOString()}] OK: ${placa} → ${dados.marca} ${dados.modelo}`)
    return res.json(dados)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERRO ${placa}:`, err.message)
    return res.status(500).json({ erro: 'Falha no scraping', detalhe: err.message })
  }
})

app.listen(PORT, () => console.log(`keplaca-scraper na porta ${PORT}`))
