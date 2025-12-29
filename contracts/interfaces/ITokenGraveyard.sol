// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title ITokenGraveyard - Composability Interface for TokenGraveyard Contract
/// @author stowerling.eth / stowerling.hbar
/// @notice Interface for permanent NFT storage with royalty bypass via staking
/// @dev For NFTs WITHOUT royalties: associate token, then send directly via Hedera SDK
/// @dev For NFTs WITH royalties: use stakeNFTsToTheGrave() to bypass royalty fees
/// @dev Lean interface for contract-to-contract interactions. Admin functions are called directly via EOAs.
interface ITokenGraveyard {
    // Custom errors
    error TooManySerials(uint256 _provided, uint256 _max);
    error BadInput();
    error TokenNotAssociated(address _token);
    error HTSAssociationFailed();
    error HTSTransferFailed();

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

    // ============================================
    // TOKEN ASSOCIATION
    // ============================================

    /// @notice Associate a token to the graveyard (free for admins and contract users)
    /// @param tokenAddress EVM address of the token to associate
    function associateTokenFree(address tokenAddress) external;

    /// @notice Batch associate multiple tokens (free for admins and contract users)
    /// @param tokenAddresses Array of EVM addresses to associate
    function batchAssociateTokens(address[] calldata tokenAddresses) external;

    // ============================================
    // NFT BURIAL METHODS
    // ============================================

    /// @notice Stake NFTs to the graveyard (for NFTs with royalties - bypasses royalty fees)
    /// @dev Caller must have NFT allowances set. Hbar drawn from LazyGasStation for association
    /// @param tokenAddress Address of the NFT collection
    /// @param serials Array of serial numbers to stake and bury (max 50)
    function stakeNFTsToTheGrave(
        address tokenAddress,
        uint256[] calldata serials
    ) external;

    /// @notice Contract users can stake NFTs on behalf of others (e.g., token swap contracts)
    /// @dev Caller must be a registered contract user. User must have set NFT allowances to calling contract
    /// @param tokenAddress Address of the NFT collection
    /// @param serials Array of serial numbers to stake and bury
    /// @param onBehalfOf The user who owns the NFTs
    function stakeNFTsToTheGraveOnBehalf(
        address tokenAddress,
        uint256[] calldata serials,
        address onBehalfOf
    ) external;

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /// @notice Check if a token is associated with the graveyard
    /// @param tokenAddress Address of the token to check
    /// @return isAssociated True if the token is associated
    function isTokenAssociated(
        address tokenAddress
    ) external view returns (bool isAssociated);

    /// @notice Check if an address is a contract user
    /// @param account Address to check
    /// @return isContractUser True if the address is a contract user
    function isContractUser(
        address account
    ) external view returns (bool isContractUser);
}
