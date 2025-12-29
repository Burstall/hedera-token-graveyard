// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

/// @title Core Staking Module for NFTs
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev Uses hbar for royalties making it generic
/// @dev Version 2.3 - 1 tinybar only, refill only hbar, protecting association methods for graveyard.

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {
    IHederaTokenServiceLite
} from "./interfaces/IHederaTokenServiceLite.sol";

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title TokenStaker - Core Staking Module for NFTs
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev Uses hbar for royalties making it generic. Version 2.2 - 1 tinybar only, refill only hbar.
contract TokenStaker is HederaTokenServiceLite {
    using SafeCast for uint256;
    using SafeCast for int256;

    error FailedToInitialize();
    error BadArguments();
    error NFTTransferFailed(TransferDirection _direction);
    error AssociationFailed();
    error BatchAssociationFailed();

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    /// @notice Address of the $LAZY token contract
    address public lazyToken;
    /// @notice LazyGasStation contract for hbar refills
    ILazyGasStation public lazyGasStation;
    /// @notice LazyDelegateRegistry contract for NFT delegation
    ILazyDelegateRegistry public lazyDelegateRegistry;
    uint256 private constant MAX_NFTS_PER_TX = 8;

    modifier refill() {
        // check the balance of the contract and refill if necessary
        if (address(this).balance < 20) {
            lazyGasStation.refillHbar(50);
        }
        _;
    }

    /// @notice Initialize the contract with required ecosystem contracts
    /// @param _lazyToken Address of the $LAZY token contract
    /// @param _lazyGasStation Address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry Address of the LazyDelegateRegistry contract
    function initContracts(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) internal {
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = HederaTokenServiceLite.associateToken(
            address(this),
            lazyToken
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }
    }

    /// @notice Internal function to transfer NFTs between user and contract
    /// @param _direction Direction of transfer (STAKING or WITHDRAWAL)
    /// @param _collectionAddress Address of the NFT collection
    /// @param _serials Array of serial numbers to transfer (max 8)
    /// @param _transferInitiator Address initiating the transfer
    /// @param _delegate Whether to use LazyDelegateRegistry for delegation
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate
    ) internal {
        if (_serials.length > 8) revert BadArguments();

        (
            address receiverAddress,
            address senderAddress,
            bool isHbarApproval
        ) = _determineTransferAddresses(_direction, _transferInitiator);

        IHederaTokenServiceLite.TokenTransferList[]
            memory _transfers = new IHederaTokenServiceLite.TokenTransferList[](
                _serials.length
            );

        IHederaTokenServiceLite.TransferList
            memory _hbarTransfer = _prepareHbarTransfer(
                receiverAddress,
                senderAddress,
                isHbarApproval
            );

        _handleDelegationBefore(
            _delegate,
            _direction,
            _collectionAddress,
            _serials
        );

        _prepareNFTTransfers(
            _transfers,
            _collectionAddress,
            _serials,
            senderAddress,
            receiverAddress,
            isHbarApproval
        );

        int256 response = HederaTokenServiceLite.cryptoTransfer(
            _hbarTransfer,
            _transfers
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed(_direction);
        }

        _handleDelegationAfter(
            _delegate,
            _direction,
            _collectionAddress,
            _serials,
            senderAddress
        );
    }

    /// @notice Handle delegation logic before NFT transfer
    /// @param _delegate Whether delegation is enabled
    /// @param _direction Transfer direction
    /// @param _collectionAddress NFT collection address
    /// @param _serials Array of serial numbers
    function _handleDelegationBefore(
        bool _delegate,
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials
    ) private {
        if (_delegate && _direction == TransferDirection.WITHDRAWAL) {
            lazyDelegateRegistry.revokeDelegateNFT(
                _collectionAddress,
                _serials
            );
        }
    }

    /// @notice Handle delegation logic after NFT transfer
    /// @param _delegate Whether delegation is enabled
    /// @param _direction Transfer direction
    /// @param _collectionAddress NFT collection address
    /// @param _serials Array of serial numbers
    /// @param senderAddress Original sender address
    function _handleDelegationAfter(
        bool _delegate,
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address senderAddress
    ) private {
        if (_delegate && _direction == TransferDirection.STAKING) {
            lazyDelegateRegistry.delegateNFT(
                senderAddress,
                _collectionAddress,
                _serials
            );
        }
    }

    /// @notice Internal helper to determine sender, receiver, and approval mode based on transfer direction
    /// @param _direction Direction of transfer (STAKING or WITHDRAWAL)
    /// @param _transferInitiator Address initiating the transfer
    /// @return receiverAddress Address receiving the NFTs
    /// @return senderAddress Address sending the NFTs
    /// @return isHbarApproval Whether hbar approval is being used
    function _determineTransferAddresses(
        TransferDirection _direction,
        address _transferInitiator
    )
        private
        view
        returns (
            address receiverAddress,
            address senderAddress,
            bool isHbarApproval
        )
    {
        if (_direction == TransferDirection.STAKING) {
            receiverAddress = address(this);
            senderAddress = _transferInitiator;
        } else {
            receiverAddress = _transferInitiator;
            senderAddress = address(this);
            isHbarApproval = true;
        }
    }

    /// @notice Internal helper to prepare hbar transfer structure
    /// @param receiverAddress Address receiving hbar
    /// @param senderAddress Address sending hbar
    /// @param isHbarApproval Whether hbar approval is being used
    /// @return _hbarTransfer Prepared hbar transfer structure
    function _prepareHbarTransfer(
        address receiverAddress,
        address senderAddress,
        bool isHbarApproval
    )
        private
        pure
        returns (IHederaTokenServiceLite.TransferList memory _hbarTransfer)
    {
        _hbarTransfer.transfers = new IHederaTokenServiceLite.AccountAmount[](
            2
        );

        _hbarTransfer.transfers[0].accountID = receiverAddress;
        _hbarTransfer.transfers[0].amount = -1;
        _hbarTransfer.transfers[0].isApproval = isHbarApproval;

        _hbarTransfer.transfers[1].accountID = senderAddress;
        _hbarTransfer.transfers[1].amount = 1;
    }

    /// @notice Internal helper to prepare NFT transfer data structures
    /// @param _transfers Array of TokenTransferList to populate
    /// @param _collectionAddress NFT collection address
    /// @param _serials Array of serial numbers
    /// @param senderAddress Sender address
    /// @param receiverAddress Receiver address
    /// @param isHbarApproval Whether hbar approval is being used
    function _prepareNFTTransfers(
        IHederaTokenServiceLite.TokenTransferList[] memory _transfers,
        address _collectionAddress,
        uint256[] memory _serials,
        address senderAddress,
        address receiverAddress,
        bool isHbarApproval
    ) private pure {
        for (uint256 i = 0; i < _serials.length; ++i) {
            IHederaTokenServiceLite.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            _nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;

            _transfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(_serials[i]));
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }
    }

    /// @notice Associate a token with this contract via Hedera Token Service
    /// @dev Internal to prevent bypassing payment logic in child contracts
    /// @param tokenId Address of the token to associate
    function tokenAssociate(address tokenId) internal {
        int256 response = HederaTokenServiceLite.associateToken(
            address(this),
            tokenId
        );

        if (
            !(response == HederaResponseCodes.SUCCESS ||
                response ==
                HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    /// @notice Associate multiple tokens with this contract in a single transaction
    /// @dev Internal to prevent bypassing payment logic in child contracts
    /// @param tokenIds Array of token addresses to associate
    function batchTokenAssociate(address[] memory tokenIds) internal {
        int256 response = HederaTokenServiceLite.associateTokens(
            address(this),
            tokenIds
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert BatchAssociationFailed();
        }
    }

    /// @notice Associate a group of tokens one at a time to ensure already associated tokens are safely handled
    /// @dev Internal - less gas efficient than batchTokenAssociate but handles already-associated tokens gracefully
    /// @param tokenIds Array of token addresses to associate
    function safeBatchTokenAssociate(address[] memory tokenIds) internal {
        uint256 tokenArrayLength = tokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            tokenAssociate(tokenIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Associate tokens by comparing against already-associated tokens list
    /// @dev Internal - less gas efficient than batchTokenAssociate but more efficient than safeBatchTokenAssociate. High gas costs due to nested loops.
    /// @param tokenIds Array of token addresses to associate
    /// @param existingTokenIds Array of token addresses already associated
    function noClashBatchTokenAssociate(
        address[] memory tokenIds,
        address[] memory existingTokenIds
    ) internal {
        uint256 tokenArrayLength = tokenIds.length;
        uint256 existingTokenArrayLength = existingTokenIds.length;
        for (uint256 i = 0; i < tokenArrayLength; ) {
            bool clash = false;
            for (uint256 j = 0; j < existingTokenArrayLength; ) {
                if (tokenIds[i] == existingTokenIds[j]) {
                    clash = true;
                    break;
                }
                unchecked {
                    ++j;
                }
            }
            if (!clash) {
                tokenAssociate(tokenIds[i]);
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Internal function to move NFTs in batches of 8
    /// @param _direction Direction of transfer (STAKING or WITHDRAWAL)
    /// @param _collectionAddress Address of the NFT collection
    /// @param _serials Array of serial numbers to transfer
    /// @param _transferInitiator Address initiating the transfer
    /// @param _delegate Whether to use LazyDelegateRegistry for delegation
    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
        bool _delegate
    ) internal refill {
        // check the number of serials and send in batchs of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) > MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                ++inner
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                _transferInitiator,
                _delegate
            );
        }
    }
}
