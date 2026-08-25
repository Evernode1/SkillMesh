"""
SkillMesh end-to-end contract test.

Runs against a local GenLayer Studio instance, following GenLayer's official
testing pattern: https://docs.genlayer.com/developers/decentralized-applications/testing

    pip install -r tests/requirements.txt
    # start GenLayer Studio locally first
    pytest tests/test.py -v -s
"""

import json
import time

import pytest
from tools.request import (
    create_new_account,
    deploy_intelligent_contract,
    send_transaction,
    call_contract_method,
)
from tools.response import has_success_status

ORACLE_PATH = "contracts/certifier_oracle.py"
BOARD_PATH = "contracts/hiring_board.py"

STRONG_EVIDENCE = (
    "I built a Solidity ERC-20 token with a custom vesting schedule, wrote Foundry tests "
    "covering edge cases like cliff boundaries and overflow, and deployed it to Sepolia. "
    "The vesting math uses linear interpolation between cliff and end timestamps."
)
WEAK_EVIDENCE = "I know solidity pretty well I think."


@pytest.fixture(scope="module")
def deployer():
    return create_new_account()


@pytest.fixture(scope="module")
def candidate():
    return create_new_account()


@pytest.fixture(scope="module")
def employer():
    return create_new_account()


@pytest.fixture(scope="module")
def oracle_address(deployer):
    code = open(ORACLE_PATH, "r").read()
    address, deploy_response = deploy_intelligent_contract(deployer, code, "{}")
    assert has_success_status(deploy_response)
    print(f"\n[deploy] CertifierOracle deployed at {address}")
    return address


@pytest.fixture(scope="module")
def board_address(deployer, oracle_address):
    code = open(BOARD_PATH, "r").read()
    args = json.dumps({"oracle_value": oracle_address})
    address, deploy_response = deploy_intelligent_contract(deployer, code, args)
    assert has_success_status(deploy_response)
    print(f"[deploy] HiringBoard deployed at {address}, pointing at oracle {oracle_address}")
    return address


def test_stats_start_at_zero(oracle_address, deployer):
    stats = json.loads(call_contract_method(oracle_address, deployer, "get_stats", []))
    assert stats["total_issued"] == "0"
    assert stats["total_certified"] == "0"


def test_not_certified_before_any_request(oracle_address, deployer, candidate):
    result = call_contract_method(oracle_address, deployer, "is_certified", [candidate.address, "solidity"])
    assert result is False


def test_strong_evidence_likely_certifies(oracle_address, candidate):
    response = send_transaction(candidate, oracle_address, "request_certification", ["solidity", STRONG_EVIDENCE, int(time.time() * 1000)])
    assert has_success_status(response)
    record = json.loads(call_contract_method(oracle_address, candidate, "get_certification", [candidate.address, "solidity"]))
    print(f"[verdict] {record['verdict']} (confidence={record['confidence']}) — {record['reasoning']}")
    assert record["skill"] == "solidity"


def test_weak_evidence_is_judged_independently(oracle_address, candidate):
    response = send_transaction(candidate, oracle_address, "request_certification", ["marathon-running", WEAK_EVIDENCE, int(time.time() * 1000)])
    assert has_success_status(response)
    record = json.loads(call_contract_method(oracle_address, candidate, "get_certification", [candidate.address, "marathon-running"]))
    print(f"[verdict] {record['verdict']} (confidence={record['confidence']}) — {record['reasoning']}")
    assert record["attempt_count"] == "1"


def test_cross_contract_gating_blocks_uncertified_candidate(oracle_address, board_address, employer, candidate):
    send_transaction(employer, board_address, "post_job", ["Smart contract audit help", "Review a small DeFi contract", "rust", 0, int(time.time() * 1000)])
    response = send_transaction(candidate, board_address, "apply_to_job", [0, "I'd like to help", int(time.time() * 1000)])
    assert not has_success_status(response)  # candidate is not certified in "rust"


def test_cross_contract_gating_allows_certified_candidate(oracle_address, board_address, employer, candidate):
    # Reuse the "solidity" certification obtained earlier in this session.
    send_transaction(employer, board_address, "post_job", ["Solidity contract review", "Review our staking contract", "solidity", 0, int(time.time() * 1000)])
    jobs = json.loads(call_contract_method(board_address, employer, "get_jobs", [50]))
    job_id = int(jobs[0]["job_id"])

    eligible = call_contract_method(board_address, candidate, "check_eligibility", [candidate.address, job_id])
    if not eligible:
        pytest.skip("Candidate's solidity certification did not pass in this run; gating path not exercised")

    response = send_transaction(candidate, board_address, "apply_to_job", [job_id, "I can help with this", int(time.time() * 1000)])
    assert has_success_status(response)

    applications = json.loads(call_contract_method(board_address, employer, "get_applications", [job_id]))
    assert any(a["candidate"].lower() == candidate.address.lower() for a in applications)


def test_only_employer_can_mark_hired(oracle_address, board_address, employer, candidate):
    send_transaction(employer, board_address, "post_job", ["Another job", "desc", "solidity", 0, int(time.time() * 1000)])
    jobs = json.loads(call_contract_method(board_address, employer, "get_jobs", [50]))
    job_id = int(jobs[0]["job_id"])

    response = send_transaction(candidate, board_address, "mark_hired", [job_id, candidate.address])
    assert not has_success_status(response)


def test_only_owner_can_pause_oracle(oracle_address, deployer, candidate):
    non_owner_attempt = send_transaction(candidate, oracle_address, "set_paused", [True])
    assert not has_success_status(non_owner_attempt)

    owner_attempt = send_transaction(deployer, oracle_address, "set_paused", [True])
    assert has_success_status(owner_attempt)

    blocked = send_transaction(candidate, oracle_address, "request_certification", ["painting", STRONG_EVIDENCE, int(time.time() * 1000)])
    assert not has_success_status(blocked)

    send_transaction(deployer, oracle_address, "set_paused", [False])  # unpause for any later tests


def test_only_owner_can_pause_board(board_address, deployer, employer):
    non_owner_attempt = send_transaction(employer, board_address, "set_paused", [True])
    assert not has_success_status(non_owner_attempt)

    owner_attempt = send_transaction(deployer, board_address, "set_paused", [True])
    assert has_success_status(owner_attempt)

    blocked = send_transaction(employer, board_address, "post_job", ["Blocked job", "desc", "solidity", 0, int(time.time() * 1000)])
    assert not has_success_status(blocked)

    send_transaction(deployer, board_address, "set_paused", [False])


def test_min_confidence_gating(oracle_address, board_address, employer, candidate):
    send_transaction(employer, board_address, "post_job", ["High bar job", "desc", "solidity", 99, int(time.time() * 1000)])
    jobs = json.loads(call_contract_method(board_address, employer, "get_jobs", [50]))
    job_id = int(jobs[0]["job_id"])

    eligible = call_contract_method(board_address, candidate, "check_eligibility", [candidate.address, job_id])
    record = json.loads(call_contract_method(oracle_address, candidate, "get_certification", [candidate.address, "solidity"]))
    if int(record["confidence"]) >= 99 and record["verdict"] == "certified":
        assert eligible is True
    else:
        assert eligible is False


def test_withdraw_application(oracle_address, board_address, employer, candidate):
    send_transaction(employer, board_address, "post_job", ["Withdraw test job", "desc", "solidity", 0, int(time.time() * 1000)])
    jobs = json.loads(call_contract_method(board_address, employer, "get_jobs", [50]))
    job_id = int(jobs[0]["job_id"])

    eligible = call_contract_method(board_address, candidate, "check_eligibility", [candidate.address, job_id])
    if not eligible:
        pytest.skip("Candidate is not certified for this run; withdraw flow not exercised")

    send_transaction(candidate, board_address, "apply_to_job", [job_id, "hi", int(time.time() * 1000)])
    withdraw_response = send_transaction(candidate, board_address, "withdraw_application", [job_id])
    assert has_success_status(withdraw_response)

    # Re-applying after withdrawing should succeed since the prior application is marked withdrawn.
    reapply_response = send_transaction(candidate, board_address, "apply_to_job", [job_id, "hi again", int(time.time() * 1000)])
    assert has_success_status(reapply_response)
