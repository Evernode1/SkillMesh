import { createClient, createAccount, generatePrivateKey } from "https://esm.sh/genlayer-js@0.28.0";
import { studionet } from "https://esm.sh/genlayer-js@0.28.0/chains";
import { TransactionStatus } from "https://esm.sh/genlayer-js@0.28.0/types";

const STORAGE_MODE = 'skillmesh_wallet_mode';        // 'none' | 'generated' | 'injected'
const STORAGE_ADDRESS = 'skillmesh_wallet_address';
const STORAGE_GENERATED_KEY = 'skillmesh_generated_key';

let client = null;
let readOnlyClient = null;
let config = null;

function maskAddress(a) { if (!a) return ''; return a.slice(0, 6) + '…' + a.slice(-4); }

async function fetchConfig() {
  if (config) return config;
  config = await (await fetch('/api/config')).json();
  return config;
}

async function getReadOnlyClient() {
  if (readOnlyClient) return readOnlyClient;
  readOnlyClient = createClient({ chain: studionet });
  return readOnlyClient;
}

function waitForEthereumProvider(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.ethereum) return resolve(window.ethereum);
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.ethereum) {
        clearInterval(interval);
        resolve(window.ethereum);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
    window.addEventListener('ethereum#initialized', () => {
      clearInterval(interval);
      resolve(window.ethereum);
    }, { once: true });
  });
}

// ---------------------------------------------------------------------
// Two ways to get a signer, same as MoodMarket:
//   "injected"  — MetaMask / SubWallet / any browser wallet extension
//   "generated" — a private key created and kept only in this browser's
//                 localStorage. Non-custodial, no extension required at all.
//                 This exists specifically to sidestep the mobile in-app
//                 browser wallet-injection issues seen in earlier projects.
// ---------------------------------------------------------------------

async function connectInjected() {
  const { network: net } = await fetchConfig();
  const provider = await waitForEthereumProvider();
  if (!provider) {
    throw new Error('No injected wallet found. Try the Browser Wallet option instead, or install a wallet extension.');
  }
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: net.chainIdHex }] });
  } catch (e) {
    if (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902)) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: net.chainIdHex,
          chainName: net.chainName,
          rpcUrls: net.rpcUrls,
          nativeCurrency: net.nativeCurrency,
          blockExplorerUrls: net.blockExplorerUrls,
        }],
      });
    } else {
      throw e;
    }
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = accounts[0];
  if (!address) throw new Error('No wallet account was returned.');

  client = createClient({ chain: studionet, account: address });
  localStorage.setItem(STORAGE_MODE, 'injected');
  localStorage.setItem(STORAGE_ADDRESS, address);
  localStorage.removeItem(STORAGE_GENERATED_KEY);
  setUIConnected(address, 'injected');
  return address;
}

function useGeneratedWallet() {
  let key = localStorage.getItem(STORAGE_GENERATED_KEY);
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(STORAGE_GENERATED_KEY, key);
  }
  const account = createAccount(key);
  client = createClient({ chain: studionet, account });
  localStorage.setItem(STORAGE_MODE, 'generated');
  localStorage.setItem(STORAGE_ADDRESS, account.address);
  setUIConnected(account.address, 'generated');
  return account.address;
}

function importGeneratedWallet(privateKey) {
  const key = privateKey.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('That doesn\'t look like a valid private key (expected 0x + 64 hex characters).');
  }
  const account = createAccount(key);
  localStorage.setItem(STORAGE_GENERATED_KEY, key);
  client = createClient({ chain: studionet, account });
  localStorage.setItem(STORAGE_MODE, 'generated');
  localStorage.setItem(STORAGE_ADDRESS, account.address);
  setUIConnected(account.address, 'generated');
  return account.address;
}

function exportPrivateKey() {
  return localStorage.getItem(STORAGE_GENERATED_KEY);
}

function disconnect() {
  localStorage.removeItem(STORAGE_MODE);
  localStorage.removeItem(STORAGE_ADDRESS);
  // Deliberately keep STORAGE_GENERATED_KEY so a generated wallet survives a
  // disconnect — losing it would mean losing access to anything tied to it.
  client = null;
  setUIDisconnected();
}

function isConnected() {
  return localStorage.getItem(STORAGE_MODE) !== null && !!localStorage.getItem(STORAGE_ADDRESS);
}
function getAddress() { return localStorage.getItem(STORAGE_ADDRESS) || ''; }
function getMode() { return localStorage.getItem(STORAGE_MODE) || 'none'; }

async function ensureConnected() {
  if (!isConnected()) throw new Error('Please connect a wallet first');
  if (!client) {
    // Rehydrate the client after a page reload.
    const mode = getMode();
    if (mode === 'generated') {
      const key = localStorage.getItem(STORAGE_GENERATED_KEY);
      if (!key) throw new Error('Your browser wallet key is missing. Please reconnect.');
      client = createClient({ chain: studionet, account: createAccount(key) });
    } else if (mode === 'injected') {
      client = createClient({ chain: studionet, account: getAddress() });
    }
  }
  return getAddress();
}

// ---------------------------------------------------------------------
// UI wiring for the wallet panel (shared markup across every page)
// ---------------------------------------------------------------------

function setUIConnected(address, mode) {
  const btn = document.getElementById('walletToggleBtn');
  if (btn) btn.textContent = maskAddress(address);
  const idEl = document.getElementById('walletIdentity');
  if (idEl) idEl.textContent = address;
  const modeEl = document.getElementById('walletModeLabel');
  if (modeEl) modeEl.textContent = mode === 'injected' ? 'Injected wallet' : 'Browser wallet';
  const disconnectBtn = document.getElementById('walletDisconnectBtn');
  if (disconnectBtn) disconnectBtn.style.display = 'flex';
  document.querySelectorAll('.lockable').forEach((el) => el.classList.remove('is-locked'));
}

function setUIDisconnected() {
  const btn = document.getElementById('walletToggleBtn');
  if (btn) btn.textContent = 'Connect Wallet';
  const idEl = document.getElementById('walletIdentity');
  if (idEl) idEl.textContent = 'Browsing read-only';
  const modeEl = document.getElementById('walletModeLabel');
  if (modeEl) modeEl.textContent = 'Read-only';
  const disconnectBtn = document.getElementById('walletDisconnectBtn');
  if (disconnectBtn) disconnectBtn.style.display = 'none';
  document.querySelectorAll('.lockable').forEach((el) => el.classList.add('is-locked'));
}

function withStatus(fn) {
  return async () => {
    const status = document.getElementById('walletStatusMsg');
    try {
      await fn();
      if (status) status.textContent = '';
    } catch (e) {
      if (status) status.textContent = e.message || String(e);
      else alert(e.message || String(e));
    }
  };
}

let _wired = false;
function init() {
  if (_wired) return;
  _wired = true;

  const toggleBtn = document.getElementById('walletToggleBtn');
  const panel = document.getElementById('walletPanel');
  const useGeneratedBtn = document.getElementById('walletUseGeneratedBtn');
  const useInjectedBtn = document.getElementById('walletUseInjectedBtn');
  const exportBtn = document.getElementById('walletExportBtn');
  const disconnectBtn = document.getElementById('walletDisconnectBtn');
  const importInput = document.getElementById('walletImportInput');
  const importBtn = document.getElementById('walletImportBtn');
  const status = document.getElementById('walletStatusMsg');

  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', (ev) => {
      if (!panel.contains(ev.target) && ev.target !== toggleBtn) panel.style.display = 'none';
    });
  }

  if (useGeneratedBtn) {
    useGeneratedBtn.addEventListener('click', withStatus(async () => {
      useGeneratedWallet();
      if (status) status.textContent = 'Browser wallet active.';
    }));
  }

  if (useInjectedBtn) {
    useInjectedBtn.addEventListener('click', withStatus(async () => {
      await connectInjected();
      if (status) status.textContent = 'Injected wallet connected.';
    }));
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', withStatus(async () => {
      const key = exportPrivateKey();
      if (!key) throw new Error('No browser wallet key is active yet.');
      await navigator.clipboard.writeText(key);
      if (status) status.textContent = 'Private key copied. This is non-custodial — store it yourself, SkillMesh never sees it.';
    }));
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', withStatus(async () => {
      disconnect();
      if (status) status.textContent = 'Disconnected. Your browser wallet key (if any) stays saved locally.';
    }));
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', withStatus(async () => {
      importGeneratedWallet(importInput.value);
      importInput.value = '';
      if (status) status.textContent = 'Imported.';
    }));
  }

  const mode = getMode();
  const address = getAddress();
  if (mode !== 'none' && address) {
    setUIConnected(address, mode);
  } else {
    setUIDisconnected();
  }
}

// --- Generic contract helpers (both fixed, pre-deployed contracts) ---

async function readContract(address, functionName, args = []) {
  const c = client || await getReadOnlyClient();
  return c.readContract({ address, functionName, args });
}

let _writeInFlight = false;

async function writeContract(address, functionName, args = []) {
  if (_writeInFlight) throw new Error('Another transaction is already in progress. Please wait for it to finish.');
  if (!client) throw new Error('Wallet not connected');
  _writeInFlight = true;
  try {
    const hash = await client.writeContract({ address, functionName, args });
    return await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 200, interval: 5000 });
  } finally {
    _writeInFlight = false;
  }
}

async function readWithRetry(fn, retriesLeft = 3) {
  try {
    return await fn();
  } catch (e) {
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 2500));
      return readWithRetry(fn, retriesLeft - 1);
    }
    throw e;
  }
}

export {
  maskAddress,
  fetchConfig,
  getAddress,
  getMode,
  isConnected,
  ensureConnected,
  disconnect,
  init,
  readContract,
  writeContract,
  readWithRetry,
};
