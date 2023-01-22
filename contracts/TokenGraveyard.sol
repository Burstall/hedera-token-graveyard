// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";

// Import OpenZeppelin Contracts where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract LAZYTokenCreator {
    function burn(address token, uint32 amount)
        external
        returns (int256 responseCode)
    {}
}

contract TokenGraveyard is HederaTokenService, Ownable {
    uint256 private _pmtAmt;
	uint256 private _lazyPmtAmt;
	LazyDetails private _lazyDetails;

	struct LazyDetails {
		address lazyToken;
		uint lazyBurnPerc;
		LAZYTokenCreator lazySCT;
	}

    /// @param amt required payment in tiny bar
    constructor(
		uint256 amt,
		address lsct, 
		address lazy,
		uint256 lazyPmtAmt,
		uint256 lazyBurnPerc) {
        _pmtAmt = amt;
		_lazyPmtAmt = lazyPmtAmt;

		_lazyDetails = LazyDetails(lazy, lazyBurnPerc, LAZYTokenCreator(lsct));

		_tokenAssociate(_lazyDetails.lazyToken);
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

        _tokenAssociate(tokenId);
    }

	function _tokenAssociate(address tokenId) internal {

        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        emit GraveyardEvent(msg.sender, tokenId, "Associated");

        if (response != HederaResponseCodes.SUCCESS) {
            revert("Associate Failed");
        }
    }

	/// Use HTS to transfer FT - add the burn
    function takeLazyPayment()
		internal 
	{
		require(IERC721(_lazyDetails.lazyToken).balanceOf(msg.sender) >= _lazyPmtAmt, "Not $LAZY enough");

		int responseCode = transferToken(
			_lazyDetails.lazyToken,
			msg.sender,
			address(this),
			SafeCast.toInt64(int256(_lazyPmtAmt))
		);

		if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("Taking LAZY payment failed");
        }

		uint256 burnAmt = SafeMath.div(SafeMath.mul(_lazyPmtAmt, _lazyDetails.lazyBurnPerc), 100);

		// This is a safe cast to uint32 as max value is >> max supply of Lazy
		
		if (burnAmt > 0) {
			responseCode = _lazyDetails.lazySCT.burn(_lazyDetails.lazyToken, SafeCast.toUint32(burnAmt));
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("Burn Failed");
        	}
		}
    }

	// function to transfer NFTs to that SC
	// must be called by the owner of the NFTs
	// handles 8 NFTs at a time
	/// @param tokenId token ID of the NFT collection
	/// @param serials array of serial numbers of the NFTs to transfer
    function sendNFTsToTheGrave(
        address tokenId,
        uint256[] memory serials
    ) external payable {
		require(msg.value >= _pmtAmt, "Needs more HBAR -> getCost()");
        require(serials.length <= 8, "Too many serials provided");
        address receiverAddress;
        address senderAddress;

        receiverAddress = address(this);
        senderAddress = msg.sender;
		string memory serialsSentToGrave = "Serials sent to the Grave: ";

		// check if the contract has already associated the token
		if(IERC721(tokenId).balanceOf(receiverAddress) == 0) _tokenAssociate(tokenId);

		// take $LAZY pmt from sender
		// this ensures the contract is $LAZY enough for the staking
		takeLazyPayment();

        // sized to a single move, expandable to up to 10 elements (untested)
        IHederaTokenService.TokenTransferList[]
            memory _transfers = new IHederaTokenService.TokenTransferList[](
                serials.length + 1
            );
        //transfer lazy token
        _transfers[0].transfers = new IHederaTokenService.AccountAmount[](2);
        _transfers[0].token = _lazyDetails.lazyToken;

        IHederaTokenService.AccountAmount memory _sendAccountAmount;
        _sendAccountAmount.accountID = receiverAddress;
        _sendAccountAmount.amount = -1;
        _transfers[0].transfers[0] = _sendAccountAmount;

        IHederaTokenService.AccountAmount memory _recieveAccountAmount;
        _recieveAccountAmount.accountID = senderAddress;
        _recieveAccountAmount.amount = 1;
        _transfers[0].transfers[1] = _recieveAccountAmount;

        // transfer NFT
        for (uint256 i = 0; i < serials.length; i++) {
            IHederaTokenService.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            if (serials[i] == 0) {
                continue;
            }
            _transfers[i + 1].token = tokenId;
            _transfers[i + 1]
                .nftTransfers = new IHederaTokenService.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(serials[i]));
            _transfers[i + 1].nftTransfers[0] = _nftTransfer;

			serialsSentToGrave = string.concat(serialsSentToGrave, Strings.toString(serials[i]), ",");
        }

        int256 response = HederaTokenService.cryptoTransfer(_transfers);

        if (response != HederaResponseCodes.SUCCESS) {
            revert("NFT transfer failed");
        }

		emit GraveyardEvent(msg.sender, tokenId, serialsSentToGrave);
    }

	/// Use HTS to retrieve LAZY
    /// @param receiver The receiver of the transaction
    /// @param amount Non-negative value to send. a negative value will result in a failure.
    function retrieveLazy(
        address receiver,
        int64 amount
    )
		external
		onlyOwner 
	returns (int responseCode) {
		require(amount > 0, "Amount must be positive");
        responseCode = HederaTokenService.transferToken(
            _lazyDetails.lazyToken,
            address(this),
            receiver,
            amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("error retrieving lazy");
        }
    }

    /// @param amt update required payment in tiny bar
	/// @param lazyCost update required lazy cost
    function updateCost(uint256 amt, uint256 lazyCost) external onlyOwner {
        _pmtAmt = amt;
		_lazyPmtAmt = lazyCost;
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

    /// @return hbarCost the current cost to use graveyard
	/// @return lazyCost the current cost to use graveyard ($LAZY only needed when staking)
    function getCost() external view returns (uint hbarCost, uint lazyCost) {
        hbarCost = _pmtAmt;
		lazyCost = _lazyPmtAmt;
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
