# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json
import datetime

CONFIDENCE_AGREEMENT_TOLERANCE = 15  # max points two validators' confidence scores may differ by and still agree


@allow_storage
@dataclass
class Certification:
    skill: str
    holder: Address
    evidence: str
    proof_url: str
    proof_fetched: bool
    verdict: str          # "certified" | "not_certified"
    confidence: u256
    reasoning: str
    issued_at: str
    attempt_count: u256
    last_raw_response: str

    def to_dict(self):
        return {
            "skill": self.skill,
            "holder": self.holder.as_hex,
            "evidence": self.evidence,
            "proof_url": self.proof_url,
            "proof_fetched": str(self.proof_fetched),
            "verdict": self.verdict,
            "confidence": str(self.confidence),
            "reasoning": self.reasoning,
            "issued_at": self.issued_at,
            "attempt_count": str(self.attempt_count),
        }


class CertifierOracle(gl.Contract):
    certifications: TreeMap[str, Certification]  # key: f"{holder}:{skill}"
    holder_skills: TreeMap[Address, DynArray[str]]
    proof_owner: TreeMap[str, Address]  # proof_url -> the first holder who claimed it
    total_issued: u256
    total_certified: u256

    owner: Address
    paused: bool
    min_reattempt_seconds: u256  # cooldown between attempts for the same holder+skill

    def __init__(self):
        self.total_issued = u256(0)
        self.total_certified = u256(0)
        self.owner = gl.message.sender_address
        self.paused = False
        self.min_reattempt_seconds = u256(0)

    def _only_owner(self):
        if gl.message.sender_address.as_hex.lower() != self.owner.as_hex.lower():
            raise Exception("Only the contract owner can do this")

    @gl.public.write
    def set_paused(self, is_paused: bool):
        self._only_owner()
        self.paused = is_paused

    @gl.public.write
    def set_min_reattempt_seconds(self, seconds: int):
        self._only_owner()
        if seconds < 0:
            raise Exception("Cooldown cannot be negative")
        self.min_reattempt_seconds = u256(seconds)

    @gl.public.write
    def transfer_ownership(self, new_owner: str):
        self._only_owner()
        self.owner = Address(new_owner)

    @gl.public.write
    def request_certification(self, skill: str, evidence: str, proof_url: str):
        """
        Anyone can request certification for a skill by submitting evidence of
        their competency. AI validators independently judge whether the
        evidence demonstrates real competency.

        `proof_url` is optional but strongly recommended: a link to a repo,
        live demo, published article, portfolio page, etc. When present, the
        validators independently fetch that page themselves (it is NOT
        supplied by the candidate as text) and weigh it heavily — this is
        real, hard-to-fake proof, as opposed to a bare self-reported claim.
        A given proof URL can only ever be claimed by the first address that
        successfully submits it, so one candidate's proof can't be copied
        and reused by someone else to piggyback on it.

        The certification timestamp is the contract's own clock at the time
        of this call — it is never taken from caller input, so it can't be
        backdated or fast-forwarded to dodge the re-attempt cooldown.
        """
        if self.paused:
            raise Exception("Certification requests are currently paused")

        clean_skill = skill.strip().lower()
        clean_evidence = evidence.strip()
        clean_proof_url = proof_url.strip()
        if not clean_skill:
            raise Exception("Skill name must not be empty")
        if not clean_evidence:
            raise Exception("Evidence must not be empty")
        if len(clean_evidence) > 4000:
            raise Exception("Evidence too long (max 4000 characters)")
        if len(clean_proof_url) > 500:
            raise Exception("Proof URL too long (max 500 characters)")

        holder = gl.message.sender_address
        key = f"{holder.as_hex.lower()}:{clean_skill}"
        existing = self.certifications.get(key, None)

        if clean_proof_url:
            proof_claimant = self.proof_owner.get(clean_proof_url, None)
            if proof_claimant is not None and proof_claimant.as_hex.lower() != holder.as_hex.lower():
                raise Exception(
                    "This proof URL has already been claimed by a different address. "
                    "Proof must be tied to the identity that owns it."
                )

        now_ts = datetime.datetime.now().timestamp()

        if existing is not None and int(self.min_reattempt_seconds) > 0:
            elapsed = now_ts - float(existing.issued_at)
            if elapsed < int(self.min_reattempt_seconds):
                raise Exception(
                    f"Please wait before re-attempting this skill (cooldown: {self.min_reattempt_seconds}s)"
                )

        result = self._judge(clean_skill, clean_evidence, clean_proof_url)

        attempt_count = u256((existing.attempt_count if existing is not None else u256(0)) + 1)

        record = Certification(
            skill=clean_skill,
            holder=holder,
            evidence=clean_evidence,
            proof_url=clean_proof_url,
            proof_fetched=bool(result.get("_proof_fetched", False)),
            verdict=result["verdict"],
            confidence=u256(int(result["confidence"])),
            reasoning=result["reasoning"],
            issued_at=str(now_ts),
            attempt_count=attempt_count,
            last_raw_response=str(result.get("_raw", ""))[:2000],
        )
        self.certifications[key] = record
        self.total_issued = u256(self.total_issued + 1)
        if result["verdict"] == "certified":
            self.total_certified = u256(self.total_certified + 1)

        if clean_proof_url and self.proof_owner.get(clean_proof_url, None) is None:
            self.proof_owner[clean_proof_url] = holder

        skills = self.holder_skills.get_or_insert_default(holder)
        if clean_skill not in list(skills):
            skills.append(clean_skill)

    def _judge(self, skill: str, evidence: str, proof_url: str) -> dict:
        def leader_fn():
            proof_content = ""
            proof_fetched = False
            if proof_url and (proof_url.startswith("http://") or proof_url.startswith("https://")):
                try:
                    fetched = gl.nondet.web.render(proof_url, mode="text")
                    proof_content = str(fetched)[:6000]
                    proof_fetched = True
                except Exception as e:
                    proof_content = f"(could not fetch this URL: {str(e)[:200]})"
                    proof_fetched = False
            elif proof_url:
                proof_content = "(not a fetchable http(s) link — treat as an unverified reference only)"

            if proof_fetched:
                proof_instruction = (
                    "A proof URL was supplied and its live content is shown below, fetched "
                    "independently by the validator — the candidate did not type this part. "
                    "This is real evidence: weigh it heavily. If the fetched page contradicts, "
                    "fails to support, or is unrelated to the skill/evidence claimed, that is a "
                    "strong signal to reject, regardless of how well-written the evidence text is."
                )
            elif proof_url:
                proof_instruction = (
                    "A proof URL was supplied but could not be independently verified (either it "
                    "wasn't a fetchable link, or the fetch failed). Treat the submission as "
                    "self-reported evidence only, and hold it to a stricter bar."
                )
            else:
                proof_instruction = (
                    "No proof URL was supplied. This submission is self-reported text only, with "
                    "nothing independently verifiable. Hold it to a stricter bar than a submission "
                    "backed by a working link: vague or generic claims must fail, and even "
                    "detailed-sounding claims should not receive top confidence without any way to "
                    "check them."
                )

            prompt = f"""You are an impartial skill-certification examiner on a decentralized credentialing network. Multiple independent validators will judge this same submission and must reach consensus.

SKILL BEING CLAIMED: "{skill}"

CANDIDATE'S EVIDENCE OF COMPETENCY (self-reported by the candidate):
\"\"\"{evidence}\"\"\"

PROOF URL SUPPLIED BY CANDIDATE: {proof_url or "(none provided)"}
{proof_instruction}

INDEPENDENTLY FETCHED CONTENT FROM THAT PROOF URL (empty if none / not fetchable):
\"\"\"{proof_content}\"\"\"

Judge whether this submission, taken as a whole, demonstrates genuine, specific competency in the claimed skill — not just familiarity with the topic in general. Vague or generic claims without concrete specifics should not pass. A submission backed by verifiable, on-topic fetched content should be trusted more than an equally well-worded submission with no way to check it. Be a reasonably strict but fair examiner.

Respond ONLY with a JSON object in this exact format:
{{
    "verdict": "certified" | "not_certified",
    "confidence": int (0 to 100),
    "reasoning": str (one to two concise sentences explaining the decision, mentioning whether the proof link supported the claim if one was fetched)
}}
It is mandatory that you respond only using the JSON format above, nothing else.
Don't include any other words, characters, or markdown formatting.
Your output must be perfectly parsable by a JSON parser without errors.
"""
            raw = gl.nondet.exec_prompt(prompt)
            parsed = json.loads(_extract_json_from_string(raw))
            parsed["verdict"] = str(parsed["verdict"]).strip().lower()
            if parsed["verdict"] not in ("certified", "not_certified"):
                parsed["verdict"] = "not_certified"
            confidence = int(parsed["confidence"])
            parsed["confidence"] = max(0, min(100, confidence))  # enforce the 0-100 range regardless of what the model returned
            parsed["reasoning"] = str(parsed["reasoning"])
            parsed["_raw"] = raw
            parsed["_proof_fetched"] = proof_fetched
            return parsed

        def validator_fn(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            validator_data = leader_fn()
            if leader_data["verdict"] != validator_data["verdict"]:
                return False
            # Confidence is what HiringBoard (and any other consumer) actually
            # gates access on, so consensus must cover it too — not just the
            # verdict label. LLM confidence scores vary slightly run to run,
            # so validators agree within a tolerance rather than requiring an
            # exact match.
            return abs(leader_data["confidence"] - validator_data["confidence"]) <= CONFIDENCE_AGREEMENT_TOLERANCE

        return gl.vm.run_nondet(leader_fn, validator_fn)

    @gl.public.view
    def is_certified(self, holder: str, skill: str) -> bool:
        """The core composability entry point — other contracts call this
        directly to gate access on a verified skill."""
        key = f"{holder.lower()}:{skill.strip().lower()}"
        record = self.certifications.get(key, None)
        return record is not None and record.verdict == "certified"

    @gl.public.view
    def is_certified_with_min_confidence(self, holder: str, skill: str, min_confidence: int) -> bool:
        """A finer-grained composability entry point: lets a consumer contract
        require not just a pass, but a minimum confidence score."""
        key = f"{holder.lower()}:{skill.strip().lower()}"
        record = self.certifications.get(key, None)
        return record is not None and record.verdict == "certified" and int(record.confidence) >= min_confidence

    @gl.public.view
    def get_certification(self, holder: str, skill: str) -> str:
        key = f"{holder.lower()}:{skill.strip().lower()}"
        record = self.certifications.get(key, None)
        if record is None:
            raise Exception("No certification record found for this holder and skill")
        return json.dumps(record.to_dict())

    @gl.public.view
    def get_last_raw_response(self, holder: str, skill: str) -> str:
        key = f"{holder.lower()}:{skill.strip().lower()}"
        record = self.certifications.get(key, None)
        if record is None:
            raise Exception("No certification record found for this holder and skill")
        return record.last_raw_response

    @gl.public.view
    def get_skills_for_holder(self, holder: str) -> str:
        skills = self.holder_skills.get(Address(holder), None)
        result = []
        if skills is not None:
            for skill in skills:
                key = f"{holder.lower()}:{skill}"
                record = self.certifications.get(key, None)
                if record is not None:
                    result.append(record.to_dict())
        return json.dumps(result)

    @gl.public.view
    def get_stats(self) -> str:
        return json.dumps({
            "total_issued": str(self.total_issued),
            "total_certified": str(self.total_certified),
            "paused": str(self.paused),
        })

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_paused(self) -> bool:
        return self.paused


def _extract_json_from_string(s: str) -> str:
    """Extract a JSON object substring from a raw LLM response string."""
    start_index = s.find("{")
    end_index = s.rfind("}")
    if start_index != -1 and end_index != -1 and start_index < end_index:
        return s[start_index : end_index + 1]
    else:
        return ""
