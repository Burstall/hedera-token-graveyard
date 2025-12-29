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

/// @title Token Graveyard - Permanent NFT Storage
/// @author stowerling.eth / stowerling.hbar
/// @notice A trapdoor contract for permanently storing NFTs with royalty bypass via staking
/// @dev Inherits TokenStaker for royalty-free transfers using HTS allowances
/// @dev For NFTs WITHOUT royalties: associate token, then send directly via Hedera SDK
/// @dev For NFTs WITH royalties: use stakeNFTsToTheGrave() to bypass royalty fees
/// @dev Version 2.1 - Supports royalty bypass, role-based access, LazyGasStation integration

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {
    IHederaTokenServiceLite
} from "./interfaces/IHederaTokenServiceLite.sol";
import {TokenStaker} from "./TokenStaker.sol";

import {IRoles} from "./interfaces/IRoles.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title TokenGraveyard - Permanent NFT Storage Contract
/// @author stowerling.eth / stowerling.hbar
/// @notice A trapdoor contract for permanently storing NFTs with royalty bypass via staking
/// @dev Inherits TokenStaker for royalty-free transfers using HTS allowances. Supports role-based access control.
/// @dev For no-royalty NFTs: associate token then send directly via Hedera SDK (no contract call needed)
/// @dev For royalty NFTs: use stakeNFTsToTheGrave() to bypass royalty fees via allowance mechanism
contract TokenGraveyard is TokenStaker, IRoles, ReentrancyGuard {
    using SafeCast for uint256;
    using SafeCast for int256;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Constants
    /// @notice Maximum NFTs per staking call (batched internally, but bounded for gas safety)
    uint256 private constant MAX_STAKE_SERIALS = 50;
    /// @notice Maximum burn percentage
    uint256 private constant MAX_BURN_PERCENTAGE = 100;

    // State variables
    uint256 private _lazyCost;
    uint256 private _lazyBurnPercentage;

    EnumerableSet.AddressSet private _admins;
    EnumerableSet.AddressSet private _contractUsers;
    EnumerableSet.AddressSet private _associatedTokens;

    // Custom errors
    error ZeroAddress();
    error ZeroAmount();
    error EmptySerialArray();
    error InvalidSerialNumber(uint256 serial);
    error InvalidBurnPercentage(uint256 provided, uint256 max);
    error TooManySerials(uint256 _provided, uint256 _max);
    error LastAdmin();
    error HTSTransferFailed();
    error LazyTransferFailed();
    error HbarTransferFailed();

    // Events
    /// @notice Emitted when NFTs are permanently buried in the graveyard via staking
    /// @param user The address that buried the NFTs
    /// @param token The NFT collection address
    /// @param serials Array of serial numbers that were buried
    /// @param viaStaking Always true (staking method bypasses royalties)
    event NFTsBuried(
        address indexed user,
        address indexed token,
        uint256[] serials,
        bool viaStaking
    );

    /// @notice Emitted when a token is associated with the graveyard
    /// @param executor The address that initiated the association
    /// @param token The token that was associated
    /// @param paidAssociation True if the association was paid, false if free
    event TokenAssociated(
        address indexed executor,
        address indexed token,
        bool indexed paidAssociation
    );

    /// @notice Emitted when a role is granted or revoked
    /// @param executor The address that executed the role change
    /// @param target The address that received or lost the role
    /// @param role The role that was granted or revoked
    /// @param added True if role was granted, false if revoked
    event RoleUpdated(
        address indexed executor,
        address indexed target,
        Role role,
        bool added
    );

    /// @notice Emitted when the cost configuration is updated
    /// @param executor The address that updated the cost
    /// @param lazyCost The new cost in $LAZY tokens
    /// @param lazyBurnPercentage The new burn percentage (0-100)
    event CostUpdated(
        address indexed executor,
        uint256 indexed lazyCost,
        uint256 indexed lazyBurnPercentage
    );

    /// @notice Emitted when $LAZY tokens are withdrawn from the contract
    /// @param executor The address that initiated the withdrawal
    /// @param receiver The address that received the tokens
    /// @param amount The amount of tokens withdrawn
    event LazyWithdrawn(
        address indexed executor,
        address indexed receiver,
        uint256 indexed amount
    );

    /// @notice Emitted when hbar is withdrawn from the contract
    /// @param executor The address that initiated the withdrawal
    /// @param receiver The address that received the hbar
    /// @param amount The amount of hbar withdrawn (in tinybars)
    event HbarWithdrawn(
        address indexed executor,
        address indexed receiver,
        uint256 indexed amount
    );

    /// @notice Emitted when the contract receives hbar or fallback is called
    /// @param message Description of what triggered the event
    /// @param sender The address that sent the transaction
    /// @param value The amount of hbar sent
    event GraveyardStatus(
        string message,
        address indexed sender,
        uint256 indexed value
    );

    /// @notice Initializes the TokenGraveyard contract with required ecosystem contracts and initial configuration
    /// @param _lazyToken Address of the $LAZY token
    /// @param _lazyGasStation Address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry Address of the LazyDelegateRegistry contract (can be address(0) if not used)
    /// @param lazyCost Cost in $LAZY to use the graveyard (for regular users)
    /// @param lazyBurnPercentage Percentage of $LAZY payment to burn (0-100)
    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry,
        uint256 lazyCost,
        uint256 lazyBurnPercentage
    ) {
        if (_lazyToken == address(0) || _lazyGasStation == address(0)) {
            revert ZeroAddress();
        }
        if (lazyBurnPercentage > MAX_BURN_PERCENTAGE) {
            revert InvalidBurnPercentage(
                lazyBurnPercentage,
                MAX_BURN_PERCENTAGE
            );
        }

        _lazyCost = lazyCost;
        _lazyBurnPercentage = lazyBurnPercentage;

        // Initialize TokenStaker
        initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry);

        // Add deployer as admin
        _admins.add(msg.sender);

        // Track $LAZY token as associated
        _associatedTokens.add(_lazyToken);

        emit RoleUpdated(msg.sender, msg.sender, Role.Admin, true);
    }

    // Modifiers
    modifier onlyAdmin() {
        if (!_admins.contains(msg.sender)) {
            revert PermissionDenied(msg.sender, Role.Admin);
        }
        _;
    }

    modifier onlyAdminOrContractUser() {
        if (
            !(_admins.contains(msg.sender) ||
                _contractUsers.contains(msg.sender))
        ) {
            revert PermissionDenied(msg.sender, Role.AdminOrCreator);
        }
        _;
    }

    // ============================================
    // TOKEN ASSOCIATION
    // ============================================

    /// @notice Associate a token to the graveyard (paid version for regular users)
    /// @param tokenAddress EVM address of the token to associate
    function associateToken(address tokenAddress) external nonReentrant {
        if (_associatedTokens.contains(tokenAddress)) {
            return; // Already associated, no-op
        }

        // Take $LAZY payment via LazyGasStation
        if (_lazyCost > 0) {
            lazyGasStation.drawLazyFrom(
                msg.sender,
                _lazyCost,
                _lazyBurnPercentage
            );
        }

        _associateToken(tokenAddress, true);
    }

    /// @notice Associate a token to the graveyard (free for admins and contract users)
    /// @param tokenAddress EVM address of the token to associate
    function associateTokenFree(
        address tokenAddress
    ) external onlyAdminOrContractUser {
        if (_associatedTokens.contains(tokenAddress)) {
            return; // Already associated, no-op
        }

        _associateToken(tokenAddress, false);
    }

    /// @notice Batch associate multiple tokens (free for admins and contract users)
    /// @param tokenAddresses Array of EVM addresses to associate
    function batchAssociateTokens(
        address[] calldata tokenAddresses
    ) external onlyAdminOrContractUser {
        uint256 length = tokenAddresses.length;
        for (uint256 i = 0; i < length; ) {
            if (!_associatedTokens.contains(tokenAddresses[i])) {
                _associateToken(tokenAddresses[i], false);
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Internal function to handle token association with HTS
    /// @dev Associates token and adds to tracking set
    /// @param tokenAddress The token to associate
    /// @param paid Whether this was a paid association
    function _associateToken(address tokenAddress, bool paid) private {
        TokenStaker.tokenAssociate(tokenAddress);

        _associatedTokens.add(tokenAddress);
        emit TokenAssociated(msg.sender, tokenAddress, paid);
    }

    // ============================================
    // NFT BURIAL METHODS
    // ============================================

    /// @notice Internal helper to validate serials array
    /// @dev Checks for empty array, max count, and zero serials
    /// @param serials Array of serial numbers to validate
    function _validateSerials(uint256[] calldata serials) private pure {
        uint256 serialCount = serials.length;
        if (serialCount == 0) {
            revert EmptySerialArray();
        }
        if (serialCount > MAX_STAKE_SERIALS) {
            revert TooManySerials(serialCount, MAX_STAKE_SERIALS);
        }

        // Validate no zero serials
        for (uint256 i = 0; i < serialCount; ) {
            if (serials[i] == 0) {
                revert InvalidSerialNumber(0);
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Internal helper to handle association payment
    /// @dev Only charges if _lazyCost > 0
    function _handleAssociationPayment() private {
        if (_lazyCost > 0) {
            lazyGasStation.drawLazyFrom(
                msg.sender,
                _lazyCost,
                _lazyBurnPercentage
            );
        }
    }

    /// @notice Internal helper to execute staking burial
    /// @dev Handles association check, staking transfer, and event emission
    /// @param tokenAddress Address of the NFT collection
    /// @param serials Array of serial numbers to bury
    /// @param nftOwner The address that owns the NFTs
    /// @param paidAssociation Whether to charge for association (true for regular users)
    function _executeStakingBurial(
        address tokenAddress,
        uint256[] calldata serials,
        address nftOwner,
        bool paidAssociation
    ) private {
        // Check if token is associated, if not associate it
        if (!_associatedTokens.contains(tokenAddress)) {
            if (paidAssociation) {
                _handleAssociationPayment();
            }
            _associateToken(tokenAddress, paidAssociation);
        }

        // Use TokenStaker's batchMoveNFTs to transfer with allowances (bypasses royalties)
        // _delegate is hardcoded to false as NFTs are permanently locked in graveyard
        batchMoveNFTs(
            TransferDirection.STAKING,
            tokenAddress,
            serials,
            nftOwner,
            false // No delegation - NFTs are permanently locked
        );

        emit NFTsBuried(nftOwner, tokenAddress, serials, true);
    }

    /// @notice Stake NFTs to the graveyard (for NFTs with royalties - bypasses royalty fees)
    /// @dev User must have set NFT allowances to this contract. Hbar drawn from LazyGasStation
    /// @param tokenAddress Address of the NFT collection
    /// @param serials Array of serial numbers to stake and bury (max 50)
    function stakeNFTsToTheGrave(
        address tokenAddress,
        uint256[] calldata serials
    ) external nonReentrant {
        _validateSerials(serials);
        _executeStakingBurial(tokenAddress, serials, msg.sender, true);
    }

    /// @notice Contract users can stake NFTs on behalf of others (e.g., token swap contracts)
    /// @dev Caller must be a registered contract user. User must have set NFT allowances to calling contract
    /// @param tokenAddress Address of the NFT collection
    /// @param serials Array of serial numbers to stake and bury (max 50)
    /// @param onBehalfOf The user who owns the NFTs
    function stakeNFTsToTheGraveOnBehalf(
        address tokenAddress,
        uint256[] calldata serials,
        address onBehalfOf
    ) external onlyAdminOrContractUser nonReentrant {
        if (onBehalfOf == address(0)) {
            revert ZeroAddress();
        }
        _validateSerials(serials);
        _executeStakingBurial(tokenAddress, serials, onBehalfOf, false);
    }

    // ============================================
    // ROLE MANAGEMENT
    // ============================================

    /// @notice Add an admin
    /// @param admin Address to grant admin role
    /// @return success True if the admin was added, false if already an admin
    function addAdmin(address admin) external onlyAdmin returns (bool success) {
        if (admin == address(0)) revert ZeroAddress();
        bool added = _admins.add(admin);
        if (added) {
            emit RoleUpdated(msg.sender, admin, Role.Admin, true);
        }
        return added;
    }

    /// @notice Remove an admin
    /// @param admin Address to revoke admin role
    /// @return success True if the admin was removed, false if not an admin
    function removeAdmin(
        address admin
    ) external onlyAdmin returns (bool success) {
        if (_admins.length() == 1) {
            revert LastAdmin();
        }
        bool removed = _admins.remove(admin);
        if (removed) {
            emit RoleUpdated(msg.sender, admin, Role.Admin, false);
        }
        return removed;
    }

    /// @notice Add a contract user
    /// @param contractUser Address to grant contract user role
    /// @return success True if the contract user was added, false if already a contract user
    function addContractUser(
        address contractUser
    ) external onlyAdmin returns (bool success) {
        if (contractUser == address(0)) revert ZeroAddress();
        bool added = _contractUsers.add(contractUser);
        if (added) {
            emit RoleUpdated(
                msg.sender,
                contractUser,
                Role.GasStationContractUser,
                true
            );
        }
        return added;
    }

    /// @notice Remove a contract user
    /// @param contractUser Address to revoke contract user role
    /// @return success True if the contract user was removed, false if not a contract user
    function removeContractUser(
        address contractUser
    ) external onlyAdmin returns (bool success) {
        bool removed = _contractUsers.remove(contractUser);
        if (removed) {
            emit RoleUpdated(
                msg.sender,
                contractUser,
                Role.GasStationContractUser,
                false
            );
        }
        return removed;
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /// @notice Update the cost to use the graveyard
    /// @param lazyCost New cost in $LAZY
    /// @param lazyBurnPercentage New burn percentage (0-100)
    function updateCost(
        uint256 lazyCost,
        uint256 lazyBurnPercentage
    ) external onlyAdmin {
        if (lazyBurnPercentage > MAX_BURN_PERCENTAGE) {
            revert InvalidBurnPercentage(
                lazyBurnPercentage,
                MAX_BURN_PERCENTAGE
            );
        }
        _lazyCost = lazyCost;
        _lazyBurnPercentage = lazyBurnPercentage;
        emit CostUpdated(msg.sender, lazyCost, lazyBurnPercentage);
    }

    /// @notice Withdraw $LAZY from the contract
    /// @param receiver Address to receive the $LAZY
    /// @param amount Amount of $LAZY to withdraw
    function withdrawLazy(address receiver, uint256 amount) external onlyAdmin {
        if (receiver == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        bool success = IERC20(lazyToken).transfer(receiver, amount);
        if (!success) {
            revert LazyTransferFailed();
        }

        emit LazyWithdrawn(msg.sender, receiver, amount);
    }

    /// @notice Withdraw hbar from the contract
    /// @param receiver Address to receive the hbar
    /// @param amount Amount of hbar to withdraw (in tinybars)
    function withdrawHbar(
        address payable receiver,
        uint256 amount
    ) external onlyAdmin {
        if (receiver == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        (bool success, ) = receiver.call{value: amount}("");
        if (!success) {
            revert HbarTransferFailed();
        }

        emit HbarWithdrawn(msg.sender, receiver, amount);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /// @notice Get the current cost to use the graveyard
    /// @return lazyCost Cost in $LAZY for regular users
    /// @return lazyBurnPercentage Percentage of payment that gets burned
    function getCost()
        external
        view
        returns (uint256 lazyCost, uint256 lazyBurnPercentage)
    {
        return (_lazyCost, _lazyBurnPercentage);
    }

    /// @notice Check if a token is associated with the graveyard
    /// @param tokenAddress Address of the token to check
    /// @return isAssociated True if the token is associated
    function isTokenAssociated(
        address tokenAddress
    ) external view returns (bool isAssociated) {
        return _associatedTokens.contains(tokenAddress);
    }

    /// @notice Get all associated tokens
    /// @return tokens Array of associated token addresses
    function getAssociatedTokens()
        external
        view
        returns (address[] memory tokens)
    {
        return _associatedTokens.values();
    }

    /// @notice Get all admins
    /// @return admins Array of admin addresses
    function getAdmins() external view returns (address[] memory admins) {
        return _admins.values();
    }

    /// @notice Get all contract users
    /// @return contractUsers Array of contract user addresses
    function getContractUsers()
        external
        view
        returns (address[] memory contractUsers)
    {
        return _contractUsers.values();
    }

    /// @notice Check if an address is an admin
    /// @param account Address to check
    /// @return True if the address is an admin
    function isAdmin(address account) external view returns (bool) {
        return _admins.contains(account);
    }

    /// @notice Check if an address is a contract user
    /// @param account Address to check
    /// @return True if the address is a contract user
    function isContractUser(address account) external view returns (bool) {
        return _contractUsers.contains(account);
    }

    /// @notice Get the count of admins
    /// @return count Number of admins
    function getAdminCount() external view returns (uint256 count) {
        return _admins.length();
    }

    /// @notice Get the count of contract users
    /// @return count Number of contract users
    function getContractUserCount() external view returns (uint256 count) {
        return _contractUsers.length();
    }

    /// @notice Get the count of associated tokens
    /// @return count Number of associated tokens
    function getAssociatedTokenCount() external view returns (uint256 count) {
        return _associatedTokens.length();
    }

    /// @notice Get paginated list of admins (prevents DoS on large sets)
    /// @param offset Starting index (0-based)
    /// @param limit Maximum number of items to return
    /// @return admins Array of admin addresses in the requested range
    function getAdminsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory admins) {
        uint256 total = _admins.length();
        if (offset >= total) {
            return new address[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        admins = new address[](size);
        for (uint256 i = 0; i < size; ) {
            admins[i] = _admins.at(offset + i);
            unchecked {
                ++i;
            }
        }
        return admins;
    }

    /// @notice Get paginated list of contract users (prevents DoS on large sets)
    /// @param offset Starting index (0-based)
    /// @param limit Maximum number of items to return
    /// @return contractUsers Array of contract user addresses in the requested range
    function getContractUsersPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory contractUsers) {
        uint256 total = _contractUsers.length();
        if (offset >= total) {
            return new address[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        contractUsers = new address[](size);
        for (uint256 i = 0; i < size; ) {
            contractUsers[i] = _contractUsers.at(offset + i);
            unchecked {
                ++i;
            }
        }
        return contractUsers;
    }

    /// @notice Get paginated list of associated tokens (prevents DoS on large sets)
    /// @param offset Starting index (0-based)
    /// @param limit Maximum number of items to return
    /// @return tokens Array of token addresses in the requested range
    function getAssociatedTokensPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory tokens) {
        uint256 total = _associatedTokens.length();
        if (offset >= total) {
            return new address[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        tokens = new address[](size);
        for (uint256 i = 0; i < size; ) {
            tokens[i] = _associatedTokens.at(offset + i);
            unchecked {
                ++i;
            }
        }
        return tokens;
    }

    // ============================================
    // FALLBACK FUNCTIONS
    // ============================================

    /// @notice Receives hbar sent to the contract
    receive() external payable {
        emit GraveyardStatus("Hbar Received", msg.sender, msg.value);
    }

    /// @notice Fallback function for unknown function calls
    fallback() external payable {
        emit GraveyardStatus("Fallback Called", msg.sender, msg.value);
    }
}
