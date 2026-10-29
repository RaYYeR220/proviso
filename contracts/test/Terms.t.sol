// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Terms, TermsLib} from "../src/Terms.sol";

contract TermsHarness {
    function roundtrip(Terms memory t) external pure returns (Terms memory) {
        return TermsLib.decode(TermsLib.encode(t));
    }

    function hash(Terms memory t) external pure returns (bytes32) {
        return TermsLib.hash(t);
    }
}

contract TermsTest is Test {
    TermsHarness h = new TermsHarness();

    function test_roundtrip(Terms memory t) public view {
        Terms memory r = h.roundtrip(t);
        assertEq(r.payer, t.payer);
        assertEq(r.provider, t.provider);
        assertEq(r.token, t.token);
        assertEq(r.amount, t.amount);
        assertEq(r.deliverBy, t.deliverBy);
        assertEq(r.challengeWindow, t.challengeWindow);
        assertEq(r.courtWindow, t.courtWindow);
        assertEq(r.feeBps, t.feeBps);
        assertEq(r.courtFeeBps, t.courtFeeBps);
        for (uint256 i; i < 3; i++) assertEq(r.validators[i], t.validators[i]);
        assertEq(r.providerAgentId, t.providerAgentId);
        assertEq(r.payerAgentId, t.payerAgentId);
        assertEq(r.specHash, t.specHash);
        assertEq(r.intentHash, t.intentHash);
        assertEq(r.salt, t.salt);
    }

    function test_hash_isKeccakOfEncoding(Terms memory t) public view {
        assertEq(h.hash(t), keccak256(abi.encode(t)));
    }
}
