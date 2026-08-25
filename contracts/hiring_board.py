# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json


@allow_storage
@dataclass
class Application:
    candidate: Address
    message: str
    applied_at: str
    withdrawn: bool

    def to_dict(self):
        return {
            "candidate": self.candidate.as_hex,
            "message": self.message,
            "applied_at": self.applied_at,
            "withdrawn": str(self.withdrawn),
        }


@allow_storage
@dataclass
class Job:
    employer: Address
    title: str
    description: str
    required_skill: str
    min_confidence: u256
    created_at: str
    status: str  # "open" | "filled" | "closed"
    hired_candidate: Address

    def to_dict(self):
        return {
            "employer": self.employer.as_hex,
            "title": self.title,
            "description": self.description,
            "required_skill": self.required_skill,
            "min_confidence": str(self.min_confidence),
            "created_at": self.created_at,
            "status": self.status,
            "hired_candidate": self.hired_candidate.as_hex if self.status == "filled" else "",
        }


class HiringBoard(gl.Contract):
    oracle: Address
    jobs: TreeMap[u256, Job]
    applications: TreeMap[u256, DynArray[Application]]
    next_job_id: u256

    owner: Address
    paused: bool

    def __init__(self, oracle_value: str):
        self.oracle = Address(oracle_value)
        self.next_job_id = u256(0)
        self.owner = gl.message.sender_address
        self.paused = False

    def _only_owner(self):
        if gl.message.sender_address.as_hex.lower() != self.owner.as_hex.lower():
            raise Exception("Only the contract owner can do this")

    @gl.public.write
    def set_paused(self, is_paused: bool):
        self._only_owner()
        self.paused = is_paused

    @gl.public.write
    def transfer_ownership(self, new_owner: str):
        self._only_owner()
        self.owner = Address(new_owner)

    @gl.public.write
    def post_job(self, title: str, description: str, required_skill: str, min_confidence: int, created_at: int):
        if self.paused:
            raise Exception("New job postings are currently paused")
        if not title.strip():
            raise Exception("Title must not be empty")
        if not required_skill.strip():
            raise Exception("Required skill must not be empty")
        if min_confidence < 0 or min_confidence > 100:
            raise Exception("Minimum confidence must be between 0 and 100")
        job_id = self.next_job_id
        self.jobs[job_id] = Job(
            employer=gl.message.sender_address,
            title=title.strip(),
            description=description.strip(),
            required_skill=required_skill.strip().lower(),
            min_confidence=u256(min_confidence),
            created_at=str(created_at / 1000),
            status="open",
            hired_candidate=Address("0x0000000000000000000000000000000000000000"),
        )
        self.next_job_id = u256(job_id + 1)

    @gl.public.write
    def apply_to_job(self, job_id: int, message: str, applied_at: int):
        """
        This is the composability payoff: applying is gated on a live,
        cross-contract read of the candidate's certification status — and, if
        the job set one, a minimum confidence score — held in the separate
        CertifierOracle contract. HiringBoard never re-implements or
        duplicates that verification logic.
        """
        job = self.jobs.get(u256(job_id), None)
        if job is None:
            raise Exception("Job not found")
        if job.status != "open":
            raise Exception("This job is no longer accepting applications")

        candidate = gl.message.sender_address
        oracle_contract = gl.get_contract_at(self.oracle)
        eligible = oracle_contract.view().is_certified_with_min_confidence(
            candidate.as_hex, job.required_skill, int(job.min_confidence)
        )
        if not eligible:
            raise Exception(
                f"You don't meet the certification bar for '{job.required_skill}' "
                f"(requires at least {job.min_confidence}% confidence on the CertifierOracle)."
            )

        applicant_list = self.applications.get_or_insert_default(u256(job_id))
        for a in applicant_list:
            if a.candidate.as_hex.lower() == candidate.as_hex.lower() and not a.withdrawn:
                raise Exception("You have already applied to this job")

        applicant_list.append(Application(
            candidate=candidate,
            message=message.strip(),
            applied_at=str(applied_at / 1000),
            withdrawn=False,
        ))

    @gl.public.write
    def withdraw_application(self, job_id: int):
        applicant_list = self.applications.get(u256(job_id), None)
        if applicant_list is None:
            raise Exception("No applications found for this job")
        sender = gl.message.sender_address.as_hex.lower()
        found = False
        for a in applicant_list:
            if a.candidate.as_hex.lower() == sender and not a.withdrawn:
                a.withdrawn = True
                found = True
        if not found:
            raise Exception("You have no active application to withdraw")

    @gl.public.write
    def mark_hired(self, job_id: int, candidate: str):
        job = self.jobs.get(u256(job_id), None)
        if job is None:
            raise Exception("Job not found")
        if gl.message.sender_address.as_hex.lower() != job.employer.as_hex.lower():
            raise Exception("Only the employer who posted this job can mark it filled")
        if job.status != "open":
            raise Exception("This job is not open")

        applicant_list = self.applications.get(u256(job_id), None)
        candidate_applied = applicant_list is not None and any(
            a.candidate.as_hex.lower() == candidate.lower() and not a.withdrawn for a in applicant_list
        )
        if not candidate_applied:
            raise Exception("This address has no active application for this job")

        job.status = "filled"
        job.hired_candidate = Address(candidate)

    @gl.public.write
    def close_job(self, job_id: int):
        job = self.jobs.get(u256(job_id), None)
        if job is None:
            raise Exception("Job not found")
        if gl.message.sender_address.as_hex.lower() != job.employer.as_hex.lower():
            raise Exception("Only the employer who posted this job can close it")
        if job.status != "open":
            raise Exception("This job is not open")
        job.status = "closed"

    @gl.public.view
    def get_jobs(self, limit: int) -> str:
        ids = sorted(self.jobs.keys(), reverse=True)[:limit]
        return json.dumps([{"job_id": str(i), **self.jobs[i].to_dict()} for i in ids])

    @gl.public.view
    def get_open_jobs(self, limit: int) -> str:
        result = []
        for i in sorted(self.jobs.keys(), reverse=True):
            job = self.jobs[i]
            if job.status == "open":
                result.append({"job_id": str(i), **job.to_dict()})
            if len(result) >= limit:
                break
        return json.dumps(result)

    @gl.public.view
    def get_job(self, job_id: int) -> str:
        job = self.jobs.get(u256(job_id), None)
        if job is None:
            raise Exception("Job not found")
        return json.dumps({"job_id": str(job_id), **job.to_dict()})

    @gl.public.view
    def get_applications(self, job_id: int) -> str:
        applicant_list = self.applications.get(u256(job_id), None)
        if applicant_list is None:
            return json.dumps([])
        return json.dumps([a.to_dict() for a in applicant_list])

    @gl.public.view
    def check_eligibility(self, candidate: str, job_id: int) -> bool:
        """Lets a frontend check eligibility before submitting an application transaction."""
        job = self.jobs.get(u256(job_id), None)
        if job is None:
            raise Exception("Job not found")
        oracle_contract = gl.get_contract_at(self.oracle)
        return oracle_contract.view().is_certified_with_min_confidence(candidate, job.required_skill, int(job.min_confidence))

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_paused(self) -> bool:
        return self.paused
