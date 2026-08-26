import * as core from './core.js';

core.init();
document.addEventListener('DOMContentLoaded', routePage);
routePage();

function routePage() {
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html')) initHomePage();
  else if (path.startsWith('/jobs')) initJobsPage();
  else if (path.startsWith('/certifications')) initLookupPage();
  else if (path.startsWith('/profile')) initProfilePage();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
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
    const proofUrl = document.getElementById('c-proof').value.trim();
    if (!skill) { status.textContent = 'Please enter a skill.'; return; }
    if (!evidence) { status.textContent = 'Please enter your evidence.'; return; }
    if (evidence.length > 4000) { status.textContent = 'Evidence is too long (max 4000 characters).'; return; }
    if (proofUrl.length > 500) { status.textContent = 'Proof link is too long (max 500 characters).'; return; }

    isBusy = true;
    btn.disabled = true;
    document.getElementById('resultBox').style.display = 'none';
    status.textContent = proofUrl
      ? 'Submitting for AI review… validators will fetch your proof link independently, this can take a while.'
      : 'Submitting for AI review… this can take a while.';

    try {
      const holder = await core.ensureConnected();
      const { oracleAddress } = await core.fetchConfig();
      await core.writeContract(oracleAddress, 'request_certification', [skill, evidence, proofUrl]);
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

  const proofRow = document.getElementById('resultProofRow');
  const proofEl = document.getElementById('resultProof');
  if (result.proof_url) {
    proofRow.style.display = 'block';
    const fetched = result.proof_fetched === 'True' || result.proof_fetched === true;
    proofEl.textContent = fetched ? `${result.proof_url} (independently fetched and checked)` : `${result.proof_url} (could not be verified — judged as self-reported)`;
  } else {
    proofRow.style.display = 'none';
  }

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
    const positionsNeeded = Number(document.getElementById('j-positions').value || 1);
    if (!title || !skill) { status.textContent = 'Title and required skill are needed.'; return; }
    if (!positionsNeeded || positionsNeeded < 1) { status.textContent = 'Positions needed must be at least 1.'; return; }

    isBusy = true;
    btn.disabled = true;
    status.textContent = 'Posting job…';
    try {
      await core.ensureConnected();
      const { boardAddress } = await core.fetchConfig();
      await core.writeContract(boardAddress, 'post_job', [title, desc, skill, minConfidence, positionsNeeded, Date.now()]);
      status.textContent = 'Job posted.';
      document.getElementById('j-title').value = '';
      document.getElementById('j-desc').value = '';
      document.getElementById('j-skill').value = '';
      document.getElementById('j-min-confidence').value = '0';
      document.getElementById('j-positions').value = '1';
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

function vacancyLabel(j) {
  return `${j.positions_filled}/${j.positions_needed} hired`;
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
        <span>${vacancyLabel(j)}</span>
      </div>
      <div class="card__meta">
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
    await core.ensureConnected();
    const { boardAddress } = await core.fetchConfig();
    await core.writeContract(boardAddress, 'close_job', [Number(currentJobId)]);
  }, 'Job closed.', true));
  document.getElementById('jd-withdrawBtn').addEventListener('click', () => runJobAction(async () => {
    await core.ensureConnected();
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
    else { const j = await refreshCurrentJob(); if (j) await openJobModal(j, true); }
  } catch (e) {
    status.textContent = e.message || String(e);
  } finally {
    _jobActionBusy = false;
  }
}

async function refreshCurrentJob() {
  if (currentJobId === null) return null;
  try {
    const { boardAddress } = await core.fetchConfig();
    const raw = await core.readContract(boardAddress, 'get_job', [Number(currentJobId)]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function openJobModal(job, keepStatus = false) {
  if (!job) return;
  currentJobId = job.job_id;
  document.getElementById('jd-title').textContent = job.title;
  document.getElementById('jd-desc').textContent = job.description;
  document.getElementById('jd-skill').textContent = job.required_skill;
  document.getElementById('jd-minconf').textContent = job.min_confidence;
  document.getElementById('jd-positions').textContent = `${job.positions_filled} hired of ${job.positions_needed} needed (${job.positions_remaining} remaining) — ${job.status}`;
  if (!keepStatus) document.getElementById('jd-status').textContent = '';
  document.getElementById('jd-message').value = '';

  const hiredSection = document.getElementById('jd-hiredSection');
  const hiredList = document.getElementById('jd-hiredList');
  if (job.hired_candidates && job.hired_candidates.length) {
    hiredSection.style.display = 'block';
    hiredList.innerHTML = job.hired_candidates.map((h) => `<span class="badge-hex badge-hex--certified" style="margin:0 6px 6px 0;">${core.maskAddress(h)}</span>`).join('');
  } else {
    hiredSection.style.display = 'none';
    hiredList.innerHTML = '';
  }

  const myAddress = core.getAddress();
  const isEmployer = myAddress && myAddress.toLowerCase() === job.employer.toLowerCase();
  document.getElementById('jd-applySection').style.display = isEmployer ? 'none' : 'block';
  document.getElementById('jd-employerSection').style.display = isEmployer ? 'block' : 'none';

  const spotsLeft = Number(job.positions_remaining) > 0 && job.status === 'open';
  document.getElementById('jd-applyBtn').disabled = !spotsLeft;
  document.getElementById('jd-applyBtn').textContent = spotsLeft ? 'Check Eligibility & Apply' : 'This job has no open positions';

  if (isEmployer) {
    try {
      const { boardAddress } = await core.fetchConfig();
      const raw = await core.readContract(boardAddress, 'get_applications', [Number(job.job_id)]);
      const applicants = JSON.parse(raw);
      const hiredSet = new Set((job.hired_candidates || []).map((h) => h.toLowerCase()));
      const list = document.getElementById('jd-applicants');
      list.innerHTML = applicants.length
        ? applicants.map((a) => {
            const isHired = hiredSet.has(a.candidate.toLowerCase());
            const canHire = job.status === 'open' && Number(job.positions_remaining) > 0 && a.withdrawn !== 'True' && !isHired;
            return `
            <div class="application-row">
              <span class="application-row__addr">${core.maskAddress(a.candidate)}</span> — ${escapeHtml(a.message || '(no message)')}
              ${a.withdrawn === 'True' ? ' <span class="form-hint">(withdrawn)</span>' : ''}
              ${isHired ? ' <span class="badge-hex badge-hex--certified" style="margin-left:8px;">Hired</span>' : ''}
              ${canHire ? `<button class="btn btn--ghost btn--sm mark-hired-btn" data-candidate="${escapeAttr(a.candidate)}" style="margin-left:8px;">Mark Hired</button>` : ''}
            </div>
          `;
          }).join('')
        : '<p class="form-hint">No applicants yet.</p>';

      list.querySelectorAll('.mark-hired-btn').forEach((btn) => {
        btn.addEventListener('click', () => runJobAction(async () => {
          await core.ensureConnected();
          const { boardAddress: addr } = await core.fetchConfig();
          await core.writeContract(addr, 'mark_hired', [Number(currentJobId), btn.dataset.candidate]);
          loadJobs();
        }, 'Candidate hired.'));
      });
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
  el.innerHTML = skills.map((s) => certCardHtml(s)).join('');
}

function certCardHtml(s) {
  const proofFetched = s.proof_fetched === 'True' || s.proof_fetched === true;
  const proofLine = s.proof_url
    ? `<div class="card__meta"><span>proof: ${proofFetched ? 'verified link' : 'unverified link'}</span></div>`
    : '<div class="card__meta"><span>no proof link (self-reported)</span></div>';
  return `
    <div class="card">
      <span class="badge-hex badge-hex--${s.verdict}">${s.verdict === 'certified' ? 'Certified' : 'Not Certified'}</span>
      <p class="card__title">${escapeHtml(s.skill)}</p>
      <p class="card__desc">${escapeHtml(s.reasoning)}</p>
      <div class="card__meta">
        <span>${s.confidence}% confidence</span>
        <span>${s.attempt_count} attempt(s)</span>
      </div>
      ${proofLine}
    </div>
  `;
}

// ---------------------------------------------------------------------
// PROFILE PAGE — everything tied to the connected wallet
// ---------------------------------------------------------------------
let _profileWired = false;

async function initProfilePage() {
  if (!_profileWired) {
    _profileWired = true;
    document.querySelectorAll('#profileConnected .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#profileConnected .tab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      document.querySelectorAll('.profile-section').forEach((s) => s.style.display = 'none');
      document.getElementById(`profile-${t.dataset.section}`).style.display = 'block';
    }));
  }

  const address = core.getAddress();
  const connected = core.isConnected() && address;
  document.getElementById('profileDisconnected').style.display = connected ? 'none' : 'block';
  document.getElementById('profileConnected').style.display = connected ? 'block' : 'none';
  document.getElementById('profileAddressLine').textContent = connected
    ? `Showing everything on-chain for ${address}`
    : 'Connect a wallet to see your certificates, posted jobs, applications, and hires.';
  if (!connected) return;

  await Promise.all([
    loadMyCertificates(address),
    loadMyPostedJobs(address),
    loadMyAppliedJobs(address),
    loadMyHires(address),
  ]);
}

async function loadMyCertificates(address) {
  const el = document.getElementById('certsCards');
  try {
    const { oracleAddress } = await core.fetchConfig();
    const raw = await core.readContract(oracleAddress, 'get_skills_for_holder', [address]);
    const skills = JSON.parse(raw);
    el.innerHTML = skills.length
      ? skills.map((s) => certCardHtml(s)).join('')
      : `<div class="empty-state"><div class="empty-state__title">No certificates yet</div><p>Head to Get Certified to request your first one.</p></div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load certificates</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

function jobCardHtml(j, extraMeta = '') {
  return `
    <div class="card" data-job-id="${j.job_id}">
      <span class="status-pill status-pill--${j.status}">${j.status}</span>
      <p class="card__title">${escapeHtml(j.title)}</p>
      <p class="card__desc">${escapeHtml(j.description)}</p>
      <div class="card__meta">
        <span>requires: ${escapeHtml(j.required_skill)}</span>
        <span>${vacancyLabel(j)}</span>
      </div>
      ${extraMeta}
    </div>
  `;
}

async function loadMyPostedJobs(address) {
  const el = document.getElementById('postedCards');
  try {
    const { boardAddress } = await core.fetchConfig();
    const raw = await core.readContract(boardAddress, 'get_jobs_posted_by', [address, 100]);
    const jobs = JSON.parse(raw);
    el.innerHTML = jobs.length
      ? jobs.map((j) => jobCardHtml(j)).join('')
      : `<div class="empty-state"><div class="empty-state__title">No jobs posted yet</div><p>Post one from the Job Board.</p></div>`;
    wireProfileJobCards(el, jobs);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load posted jobs</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

async function loadMyAppliedJobs(address) {
  const el = document.getElementById('appliedCards');
  try {
    const { boardAddress } = await core.fetchConfig();
    const raw = await core.readContract(boardAddress, 'get_jobs_applied_by', [address, 100]);
    const jobs = JSON.parse(raw);
    el.innerHTML = jobs.length
      ? jobs.map((j) => {
          const wasHired = j.was_i_hired === true || j.was_i_hired === 'True';
          const withdrawn = j.my_application && (j.my_application.withdrawn === 'True');
          const myStatus = wasHired ? 'Hired' : withdrawn ? 'Withdrawn' : 'Applied';
          return jobCardHtml(j, `<div class="card__meta"><span>your status: ${myStatus}</span></div>`);
        }).join('')
      : `<div class="empty-state"><div class="empty-state__title">No applications yet</div><p>Apply to a job from the Job Board.</p></div>`;
    wireProfileJobCards(el, jobs);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load applied jobs</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

async function loadMyHires(address) {
  const el = document.getElementById('hiredCards');
  try {
    const { boardAddress } = await core.fetchConfig();
    const raw = await core.readContract(boardAddress, 'get_jobs_hired_in', [address, 100]);
    const jobs = JSON.parse(raw);
    el.innerHTML = jobs.length
      ? jobs.map((j) => jobCardHtml(j)).join('')
      : `<div class="empty-state"><div class="empty-state__title">Not hired anywhere yet</div><p>Get certified and apply to a job to change that.</p></div>`;
    wireProfileJobCards(el, jobs);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load hires</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

function wireProfileJobCards(container, jobs) {
  container.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      window.location.href = '/jobs';
    });
  });
}
