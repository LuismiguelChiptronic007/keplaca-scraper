# keplaca-scraper

API de scraping do keplaca.com para consulta de veículos pela placa.

## Como fazer deploy no Render

### 1. Suba o projeto para o GitHub
```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/SEU_USUARIO/keplaca-scraper.git
git push -u origin main
```

### 2. No Render (render.com)
- Clique em **New → Web Service**
- Conecte seu repositório GitHub
- Configure:
  - **Name:** keplaca-scraper
  - **Runtime:** Node
  - **Build Command:** `npm install`
  - **Start Command:** `node server.js`
  - **Instance Type:** Free

### 3. Variáveis de ambiente no Render
Vá em **Environment** e adicione:
```
API_SECRET = uma-chave-secreta-sua-aqui
```

### 4. Endpoint da API
Após o deploy, a URL será algo como:
```
https://keplaca-scraper.onrender.com
```

## Como usar

### Consultar uma placa
```
GET /placa/ABC1D23
Header: x-api-key: sua-chave-secreta
```

### Resposta
```json
{
  "placa": "QSW9F84",
  "marca": "VOLKSWAGEN",
  "modelo": "DELIVERY 11.180",
  "ano": "2026",
  "anoModelo": "2027",
  "cor": "BRANCA",
  "combustivel": "Diesel",
  "cilindrada": "3800 cc",
  "potencia": "175 cv",
  "especie": "CARGA",
  "carroceria": "FECHADA/MECANISMO OPERACIONAL",
  "municipio": "Santa Cruz do Rio Pardo",
  "uf": "SP",
  "chassi": "***...",
  "passageiros": "3",
  "importado": "Não",
  "fonte": "keplaca"
}
```

## Como integrar no seu Cloudflare Worker

```js
async function consultarKeplaca(placa, env) {
  const res = await fetch(
    `https://keplaca-scraper.onrender.com/placa/${placa}`,
    {
      headers: {
        'x-api-key': env.KEPLACA_SECRET
      }
    }
  )
  if (!res.ok) return null
  return await res.json()
}
```
