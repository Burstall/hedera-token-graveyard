// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.5.8 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";

// Import Ownable from the OpenZeppelin Contracts library for access control
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenGraveyard is HederaTokenService, Ownable {
    uint256 private _pmtAmt;

    /// @param amt required payment in tiny bar
    constructor(uint256 amt) {
        _pmtAmt = amt;
    }

    event GraveyardEvent(
        address indexed fromAddress,
        address indexed burialToken,
        string message
    );

    /// Call to associate a new token to the contract
    /// @param tokenId EVM token to associate
    function tokenAssociate(address tokenId) external payable {
        require(msg.value >= _pmtAmt, "Needs more HBAR -> getCost()");

        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        emit GraveyardEvent(msg.sender, tokenId, "Associated");

        if (response != HederaResponseCodes.SUCCESS) {
            revert("Associate Failed");
        }
    }

    /// @param amt update required payment in tiny bar
    function updateCost(uint256 amt) external onlyOwner {
        _pmtAmt = amt;
        emit GraveyardEvent(msg.sender, msg.sender, "Payment required updated");
    }

    // Transfer hbar oput of the contract - using secure ether transfer pattern
    // on top of onlyOwner as max gas of 2300 (not adjustable) will limit re-entrrant attacks
    // also throws error on failure causing contract to auutomatically revert
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyOwner
    {
        // throws error on failure
        receiverAddress.transfer(amount);

        emit GraveyardEvent(
            msg.sender,
            receiverAddress,
            "Hbar Transfer Complete"
        );
    }

    /// @return amt the currentcost to associate a new token
    function getCost() external view returns (uint256 amt) {
        amt = _pmtAmt;
    }

    receive() external payable {
        emit GraveyardEvent(
            msg.sender,
            msg.sender,
            "Hbar Received by Contract"
        );
    }

    fallback() external payable {
        emit GraveyardEvent(msg.sender, msg.sender, "Fallback Called");
    }
}
