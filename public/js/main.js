import * as core from './core.js?v=3';

core.init();
document.addEventListener('DOMContentLoaded', routePage);
routePage();

function routePage() {
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html')) initHomePage();
  else if (path.startsWith('/jobs')) initJobsPage();
  else if (path.startsWith('/certifications')) initLookupPage();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// HOME PAGE — Get Certified
// ---------------------------------------------------------------------
let _homeWired = false;

async function initHomePage() {
  loadStats();
  if (_homeWired) return;
  _homeWired = true;

  const btn = document.getElementById('certifyBtn');
  const status = document.getElementById('statusMsg');
  let isBusy = false;

  btn.addEventListener('click', async () => {
    if (isBusy) return;
    const skill = document.getElementById('c-skill').value.trim();
    const evidence = document.getElementById('c-evidence').value.trim();
    if (!skill) { status.textContent = 'Please enter a skill.'; return; }
    if (!evidence) { status.textContent = 'Please enter your evidence.'; return; }
    if (evidence.length > 4000) { status.textContent = 'Evidence is too long (max 4000 characters).'; return; }

    isBusy = true;
    btn.disabled = true;
    document.getElementById('resultBox').style.display = 'none';
    status.textContent = 'Submitting for AI review… this can take a while.';

    try {
      const holder = await core.ensureConnected();
      const { oracleAddress } = await core.fetchConfig();
      await core.writeContract(oracleAddress, 'request_certification', [skill, evidence, Date.now()]);
      const raw = await core.readWithRetry(() => core.readContract(oracleAddress, 'get_certification', [holder, skill]));
      renderResult(JSON.parse(raw), skill);
      status.textContent = 'Done.';
      loadStats();
    } catch (e) {
      status.textContent = e.message || String(e);
    } finally {
      isBusy = false;
      btn.disabled = false;
    }
  });
}

function renderResult(result, skill) {
  const box = document.getElementById('resultBox');
  box.style.display = 'block';
  const badge = document.getElementById('resultBadge');
  badge.className = `badge-hex badge-hex--lg badge-hex--${result.verdict}`;
  badge.textContent = result.verdict === 'certified' ? 'Certified' : 'Not Certified';
  document.getElementById('resultConfidence').textContent = result.confidence;
  document.getElementById('resultReasoning').textContent = result.reasoning;

  const rawBtn = document.getElementById('viewRawBtn');
  rawBtn.onclick = async () => {
    try {
      const holder = core.getAddress();
      const { oracleAddress } = await core.fetchConfig();
      const raw = await core.readContract(oracleAddress, 'get_last_raw_response', [holder, skill]);
      alert(raw || '(no raw response recorded)');
    } catch (e) {
      alert(e.message || String(e));
    }
  };
}

async function loadStats() {
  try {
    const { oracleAddress } = await core.fetchConfig();
    const raw = await core.readContract(oracleAddress, 'get_stats', []);
    const stats = JSON.parse(raw);
    const issuedEl = document.getElementById('statIssued');
    const certifiedEl = document.getElementById('statCertified');
    if (issuedEl) issuedEl.textContent = stats.total_issued;
    if (certifiedEl) certifiedEl.textContent = stats.total_certified;
  } catch (e) {
    console.warn('Could not load stats', e);
  }
}

// ---------------------------------------------------------------------
// JOBS PAGE
// ---------------------------------------------------------------------
let activeStatus = 'all';
let _jobsWired = false;
let currentJobId = null;

async function initJobsPage() {
  if (!_jobsWired) {
    _jobsWired = true;
    wirePostForm();
    wireJobModal();
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      activeStatus = t.dataset.status;
      loadJobs();
    }));
  }
  await loadJobs();
}

function wirePostForm() {
  const btn = document.getElementById('postJobBtn');
  const status = document.getElementById('postStatusMsg');
  let isBusy = false;
  btn.addEventListener('click', async () => {
    if (isBusy) return;
    const title = document.getElementById('j-title').value.trim();
    const desc = document.getElementById('j-desc').value.trim();
    const skill = document.getElementById('j-skill').value.trim();
    const minConfidence = Number(document.getElementById('j-min-confidence').value || 0);
    if (!title || !skill) { status.textContent = 'Title and required skill are needed.'; return; }

    isBusy = true;
    btn.disabled = true;
    status.textContent = 'Posting job…';
    try {
      await core.ensureConnected();
      const { boardAddress } = await core.fetchConfig();
      await core.writeContract(boardAddress, 'post_job', [title, desc, skill, minConfidence, Date.now()]);
      status.textContent = 'Job posted.';
      document.getElementById('j-title').value = '';
      document.getElementById('j-desc').value = '';
      document.getElementById('j-skill').value = '';
      document.getElementById('j-min-confidence').value = '0';
      loadJobs();
    } catch (e) {
      status.textContent = e.message || String(e);
    } finally {
      isBusy = false;
      btn.disabled = false;
    }
  });
}

async function loadJobs() {
  const el = document.getElementById('sectionJobs');
  el.innerHTML = '<p class="form-hint">Loading jobs…</p>';
  try {
    const { boardAddress } = await core.fetchConfig();
    const fnName = activeStatus === 'all' ? 'get_jobs' : (activeStatus === 'open' ? 'get_open_jobs' : 'get_jobs');
    const raw = await core.readContract(boardAddress, fnName, [50]);
    let jobs = JSON.parse(raw);
    if (activeStatus === 'filled') jobs = jobs.filter((j) => j.status === 'filled');
    renderJobs(jobs);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load jobs</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

function renderJobs(jobs) {
  const el = document.getElementById('sectionJobs');
  if (!jobs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">No jobs yet</div><p>Post the first one above.</p></div>`;
    return;
  }
  el.innerHTML = jobs.map((j) => `
    <div class="card" data-job-id="${j.job_id}">
      <span class="status-pill status-pill--${j.status}">${j.status}</span>
      <p class="card__title">${escapeHtml(j.title)}</p>
      <p class="card__desc">${escapeHtml(j.description)}</p>
      <div class="card__meta">
        <span>requires: ${escapeHtml(j.required_skill)}</span>
        <span>${core.maskAddress(j.employer)}</span>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('#sectionJobs .card').forEach((card) => {
    card.addEventListener('click', () => openJobModal(jobs.find((j) => j.job_id === card.dataset.jobId)));
  });
}

function wireJobModal() {
  document.getElementById('jd-close').addEventListener('click', closeJobModal);
  document.getElementById('jd-applyBtn').addEventListener('click', () => runJobAction(async () => {
    const { boardAddress } = await core.fetchConfig();
    const address = await core.ensureConnected();
    const eligible = await core.readContract(boardAddress, 'check_eligibility', [address, Number(currentJobId)]);
    if (!eligible) throw new Error('You are not yet certified in the required skill for this job. Get certified first.');
    const message = document.getElementById('jd-message').value.trim();
    await core.writeContract(boardAddress, 'apply_to_job', [Number(currentJobId), message, Date.now()]);
  }, 'Applied successfully.'));
  document.getElementById('jd-closeJobBtn').addEventListener('click', () => runJobAction(async () => {
    const { boardAddress } = await core.fetchConfig();
    await core.writeContract(boardAddress, 'close_job', [Number(currentJobId)]);
  }, 'Job closed.', true));
  document.getElementById('jd-withdrawBtn').addEventListener('click', () => runJobAction(async () => {
    const { boardAddress } = await core.fetchConfig();
    await core.writeContract(boardAddress, 'withdraw_application', [Number(currentJobId)]);
  }, 'Application withdrawn.'));
}

let _jobActionBusy = false;
async function runJobAction(fn, doneMessage, closeAfter = false) {
  const status = document.getElementById('jd-status');
  if (_jobActionBusy) return;
  _jobActionBusy = true;
  try {
    status.textContent = 'Submitting…';
    await fn();
    status.textContent = doneMessage;
    if (closeAfter) { closeJobModal(); loadJobs(); }
  } catch (e) {
    status.textContent = e.message || String(e);
  } finally {
    _jobActionBusy = false;
  }
}

async function openJobModal(job) {
  if (!job) return;
  currentJobId = job.job_id;
  document.getElementById('jd-title').textContent = job.title;
  document.getElementById('jd-desc').textContent = job.description;
  document.getElementById('jd-skill').textContent = job.required_skill;
  document.getElementById('jd-minconf').textContent = job.min_confidence;
  document.getElementById('jd-status').textContent = '';
  document.getElementById('jd-message').value = '';

  const myAddress = core.getAddress();
  const isEmployer = myAddress && myAddress.toLowerCase() === job.employer.toLowerCase();
  document.getElementById('jd-applySection').style.display = isEmployer ? 'none' : 'block';
  document.getElementById('jd-employerSection').style.display = isEmployer ? 'block' : 'none';

  if (isEmployer) {
    try {
      const { boardAddress } = await core.fetchConfig();
      const raw = await core.readContract(boardAddress, 'get_applications', [Number(job.job_id)]);
      const applicants = JSON.parse(raw);
      const list = document.getElementById('jd-applicants');
      list.innerHTML = applicants.length
        ? applicants.map((a) => `<div class="application-row"><span class="application-row__addr">${core.maskAddress(a.candidate)}</span> — ${escapeHtml(a.message || '(no message)')}</div>`).join('')
        : '<p class="form-hint">No applicants yet.</p>';
    } catch (e) {
      document.getElementById('jd-applicants').innerHTML = `<p class="form-hint">${escapeHtml(e.message || String(e))}</p>`;
    }
  }

  document.getElementById('jobDetailModal').style.display = 'flex';
}

function closeJobModal() {
  document.getElementById('jobDetailModal').style.display = 'none';
  currentJobId = null;
}

// ---------------------------------------------------------------------
// LOOKUP PAGE — public read, no wallet needed
// ---------------------------------------------------------------------
function initLookupPage() {
  const btn = document.getElementById('lookupBtn');
  if (!btn || btn.dataset.wired === 'true') return;
  btn.dataset.wired = 'true';
  const status = document.getElementById('statusMsg');

  btn.addEventListener('click', async () => {
    const address = document.getElementById('lookup-address').value.trim();
    if (!address) { status.textContent = 'Please enter an address.'; return; }
    status.textContent = 'Looking up…';
    document.getElementById('sectionResults').innerHTML = '';
    try {
      const { oracleAddress } = await core.fetchConfig();
      const raw = await core.readContract(oracleAddress, 'get_skills_for_holder', [address]);
      const skills = JSON.parse(raw);
      status.textContent = '';
      renderLookupResults(skills);
    } catch (e) {
      status.textContent = e.message || String(e);
    }
  });
}

function renderLookupResults(skills) {
  const el = document.getElementById('sectionResults');
  if (!skills.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">No certifications found</div><p>This address hasn't requested any certifications yet.</p></div>`;
    return;
  }
  el.innerHTML = skills.map((s) => `
    <div class="card">
      <span class="badge-hex badge-hex--${s.verdict}">${s.verdict === 'certified' ? 'Certified' : 'Not Certified'}</span>
      <p class="card__title">${escapeHtml(s.skill)}</p>
      <p class="card__desc">${escapeHtml(s.reasoning)}</p>
      <div class="card__meta">
        <span>${s.confidence}% confidence</span>
        <span>${s.attempt_count} attempt(s)</span>
      </div>
    </div>
  `).join('');
}
