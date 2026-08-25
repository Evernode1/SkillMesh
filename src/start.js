require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(morgan('tiny'));
app.use(cors());
app.use(express.json());

// Both contracts are pre-deployed once, by whoever sets this project up. There
// is no server-side wallet: every write (getting certified, posting a job,
// applying) is signed and paid for by the caller's own wallet.
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || '';
const BOARD_ADDRESS = process.env.BOARD_ADDRESS || '';

const BRADBURY_NETWORK = {
  chainIdHex: '0xF22F',
  chainName: 'GenLayer StudioNet',
  rpcUrls: ['https://studio.genlayer.com/api'],
  nativeCurrency: {
    name: process.env.NATIVE_CURRENCY_NAME || 'GEN',
    symbol: process.env.NATIVE_CURRENCY_SYMBOL || 'GEN',
    decimals: 18,
  },
  blockExplorerUrls: [''],
};

app.use(express.static(path.join(__dirname, '../public')));

const PAGES = ['jobs', 'certifications', 'faq', 'profile'];
PAGES.forEach((page) => {
  app.get(`/${page}`, (_req, res) => {
    res.sendFile(path.join(__dirname, `../public/${page}.html`));
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, oracleConfigured: Boolean(ORACLE_ADDRESS), boardConfigured: Boolean(BOARD_ADDRESS) });
});

app.get('/api/config', (_req, res) => {
  res.json({
    oracleAddress: ORACLE_ADDRESS,
    boardAddress: BOARD_ADDRESS,
    network: BRADBURY_NETWORK,
  });
});

// On Vercel, this file is required by api/index.js and the platform
// handles incoming requests itself — it doesn't need (or want) us to
// bind a local port. Only listen when running locally / on a normal host.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`SkillMesh server listening on port ${PORT}`);
    if (!ORACLE_ADDRESS || !BOARD_ADDRESS) {
      console.warn('WARNING: ORACLE_ADDRESS and/or BOARD_ADDRESS are not set. Deploy both contracts first, then set both env vars.');
    }
  });
}

module.exports = app;
