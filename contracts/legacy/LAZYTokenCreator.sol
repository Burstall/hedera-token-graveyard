// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

// moved folder structure given these are only included as support for testing
import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./IHederaTokenService.sol";
import {ExpiryHelper} from "./ExpiryHelper.sol";
import {KeyHelper} from "./KeyHelper.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {AddrArrayLib} from "./AddrArrayLib.sol";

// Import Ownable from the OpenZeppelin Contracts library
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Expiry Helper extends FeeHelper which extends KeyHelper
// Ownable from OZ to limit access control

contract LAZYTokenCreator is KeyHelper, ExpiryHelper, Ownable {
    using Bits for uint;
    using AddrArrayLib for AddrArrayLib.Addresses;
    using SafeCast for uint256;

    // List of trusted addresses which can mint tokens
    AddrArrayLib.Addresses private _allowanceWL;

    event TokenControllerMessage(
        string msgType,
        address indexed fromAddress,
        uint amount,
        string message
    );

    // create a fungible Token with no custom fees,
    // with calling contract as admin key
    // add a wipe key in order to allow implmentation of burn function
    // => no additional mint, no pause
    /// @param name token name
    /// @param symbol token symbol
    /// @param memo token longer form description as a string
    /// @param initialSupply number of tokens to mint
    /// @param decimals decimal for the token -> 100 of the token divisible to 1dp will be 1000 supply with decimal 1
    /// @param maxSupply Set to 0 for an infinite token, set > 0 to enforce capped suply @ maxSupply
    /// @return createdTokenAddress the address of the new token
    function createFungibleWithBurn(
        // bytes memory ed25519Key,
        string memory name,
        string memory symbol,
        string memory memo,
        uint256 initialSupply,
        uint256 decimals,
        uint32 maxSupply
    ) external payable onlyOwner returns (address createdTokenAddress) {
        // instantiate the list of keys we'll use for token create
        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);

        keys[0] = getSingleKey(
            KeyType.WIPE,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        // define the token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);
        token.tokenKeys = keys;

        if (maxSupply > 0) {
            token.tokenSupplyType = true;
            token.maxSupply = maxSupply;
        }

        // create the expiry schedule for the token using ExpiryHelper
        token.expiry = createAutoRenewExpiry(
            address(this),
            HederaTokenService.defaultAutoRenewPeriod
        );

        // call HTS precompiled contract, passing initial supply and decimals
        (int responseCode, address tokenAddress) = HederaTokenService
            .createFungibleToken(token, initialSupply, decimals);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("mint wipe key failed");
        }

        emit TokenControllerMessage(
            "MINT",
            msg.sender,
            uint256(uint64(initialSupply)),
            "Minted with wipe key"
        );

        createdTokenAddress = tokenAddress;
    }

    /// Allows spender to withdraw from your account multiple times, up to the value amount. If this function is called
    /// again it overwrites the current allowance with value.
    /// Only Applicable to Fungible Tokens
    /// @param token The hedera token address to approve
    /// @param spender the account authorized to spend
    /// @param amount the amount of tokens authorized to spend.
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function approveAllowance(
        address token,
        address spender,
        uint256 amount
    ) external onlyOwner returns (int responseCode) {
        require(_allowanceWL.exists(spender), "Spender not on WL");

        (responseCode) = HederaTokenService.approve(token, spender, amount);

        emit TokenControllerMessage(
            "Approval",
            spender,
            amount,
            "Allowance approved"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("allowance approval - failed");
        }
    }

    /// Use HTS to transfer FT
    /// @param token The token to transfer to/from
    /// @param receiver The receiver of the transaction
    /// @param amount Non-negative value to send. a negative value will result in a failure.
    function transferHTS(
        address token,
        address receiver,
        int64 amount
    ) external onlyOwner returns (int responseCode) {
        responseCode = HederaTokenService.transferToken(
            token,
            address(this),
            receiver,
            amount
        );

        require(amount > 0, "Positive transfers only");

        emit TokenControllerMessage(
            "Transfer with HTS",
            receiver,
            uint256(uint64(amount)),
            "completed"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("transferHTS - failed");
        }
    }

    // Transfer hbar oput of the contract - using secure ether transfer pattern
    // on top of onlyOwner as max gas of 2300 (not adjustable) will limit re-entrrant attacks
    // also throws error on failure causing contract to auutomatically revert
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in long form adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint amount
    ) external onlyOwner {
        // throws error on failure
        receiverAddress.transfer(amount);

        emit TokenControllerMessage(
            "Hbar Transfer",
            receiverAddress,
            amount,
            "complete"
        );
    }

    // Add an address to the allowance WL
    /// @param newAddress the new address to add
    function addAllowanceWhitelist(address newAddress) external onlyOwner {
        _allowanceWL.pushAddress(newAddress);
        emit TokenControllerMessage(
            "ADD WL",
            newAddress,
            0,
            "allowance WL updated"
        );
    }

    // Remove an address from the allowance WL
    /// @param oldAddress the address to remove
    function removeAllowanceWhitelist(address oldAddress) external onlyOwner {
        _allowanceWL.removeAddress(oldAddress);
        emit TokenControllerMessage(
            "REMOVE WL",
            oldAddress,
            0,
            "allowance WL updated"
        );
    }

    /// Operation to wipe fungible tokens from caller's account
    /// This method os open to all as the address foor burning is the msg.sender the call
    /// can only burn tokens they own
    /// @param token The token address
    /// @param amount The number of tokens to wipe
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    function burn(
        address token,
        uint32 amount
    ) external returns (int responseCode) {
        (responseCode) = HederaTokenService.wipeTokenAccount(
            token,
            msg.sender,
            amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("burn failed");
        }
        emit TokenControllerMessage(
            "BURN",
            msg.sender,
            uint256(amount),
            "Burn (from user) complete"
        );
    }

    /// Check the allowance for a specific user via an SC call [mirror node better?]
    /// @param token The Hedera token address to check the allowance of
    /// @param spender the spender of the tokens
    /// @return responseCode The response code for the status of the request. SUCCESS is 22.
    /// @return amount thw number of tokens authorised to spend
    function checkAllowance(
        address token,
        address spender
    ) external returns (int responseCode, uint256 amount) {
        (responseCode, amount) = HederaTokenService.allowance(
            token,
            address(this),
            spender
        );

        emit TokenControllerMessage(
            "Allowance checked",
            spender,
            amount,
            "checked"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("getAllowance - failed");
        }
    }

    /// Check the current White List for Approvals
    /// @return wl an array of addresses currently enabled for allownace approval
    function getAllowanceWhitelist()
        external
        view
        returns (address[] memory wl)
    {
        return _allowanceWL.getAllAddresses();
    }

    // Check if the address is in the WL
    /// @param addressToCheck the address to check in WL
    /// @return bool if in the WL
    function isAddressWL(address addressToCheck) external view returns (bool) {
        return _allowanceWL.exists(addressToCheck);
    }

    // allows the contract top recieve HBAR
    receive() external payable {
        emit TokenControllerMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit TokenControllerMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}

library Bits {
    uint internal constant ONE = uint(1);

    // Sets the bit at the given 'index' in 'self' to '1'.
    // Returns the modified value.
    function setBit(uint self, uint8 index) internal pure returns (uint) {
        return self | (ONE << index);
    }
}
