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
// Free at https://cloud.reown.com (formerly WalletConnect Cloud). Powers the
// "Connect Any EVM Wallet" button so wallet apps (not just MetaMask) can
// connect on mobile, where there's no injected window.ethereum at all.
const WALLETCONNECT_PROJECT_ID = process.env.WALLETCONNECT_PROJECT_ID || '';

const BRADBURY_NETWORK = {
  chainIdHex: '0xF22F',
  chainName: 'GenLayer StudioNet',
  rpcUrls: ['https://studio.genlayer.com/api'],
  nativeCurrency: {
    name: process.env.NATIVE_CURRENCY_NAME || 'GEN',
    symbol: process.env.NATIVE_CURRENCY_SYMBOL || 'GEN',
    decimals: 18,
  },
  blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
};

app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    // JS files change during active development; don't let browsers or the
    // Vercel edge cache hang onto a stale copy after a redeploy. HTML/CSS
    // are left with default caching since they're less prone to this.
    if (filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const PAGES = ['jobs', 'certifications', 'faq'];
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
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SkillMesh server listening on port ${PORT}`);
  if (!ORACLE_ADDRESS || !BOARD_ADDRESS) {
    console.warn('WARNING: ORACLE_ADDRESS and/or BOARD_ADDRESS are not set. Deploy both contracts first, then set both env vars.');
  }
  if (!WALLETCONNECT_PROJECT_ID) {
    console.warn('WARNING: WALLETCONNECT_PROJECT_ID is not set. The "Connect Any EVM Wallet" button will show an error until it is (free at cloud.reown.com).');
  }
});

module.exports = app;
