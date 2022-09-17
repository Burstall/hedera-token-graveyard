// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";

// Import Ownable from the OpenZeppelin Contracts library for access control
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract TokenGraveyard is HederaTokenService, Ownable {
	uint256 private _pmtAmt;

	/// @param amt required payment in tiny bar
	constructor(uint256 amt) {
		_pmtAmt = amt;
	}

	event GraveyardEvent(address indexed fromAddress, address indexed burialToken, string message);

	/// Call to associate a new token to the contract
	/// @param tokenId EVM token to associate
    function tokenAssociate(address tokenId) external {
		require(msg.value > _pmtAmt,"Service costs HBAR (tinybar -> 1*10^8) = " + _pmtAmt);

        int response = HederaTokenService.associateToken(
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

	/// @param _receiverAddress EVM address to recieve HBAR
	/// @param _amount amount of HBAR to send
	function callHbar(address payable _receiverAddress, uint _amount)
        external
        onlyOwner
        returns (bool sent)
    {
        (sent, ) = _receiverAddress.call{value: _amount}("");
        require(sent, "Failed to send Hbar");
    }

	/// @return amt the currentcost to associate a new token
	function getCost() external view returns (uint256 amt) {
		amt = _pmtAmt;
	}

    receive() external payable {
        emit GraveyardEvent(
            msg.sender,
            msg.sender,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit GraveyardEvent(
            msg.sender,
            msg.sender,
            "Fallback Called"
        );
    }
}
