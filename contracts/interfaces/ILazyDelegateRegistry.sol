// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title ILazyDelegateRegistry
/// @author stowerling.eth / stowerling.hbar
/// @notice Interface for delegating and revoking NFT delegation rights
interface ILazyDelegateRegistry {
    /// @notice Delegate NFTs to allow delegator to use them
    /// @param _delegator Address that will receive delegation rights
    /// @param _collectionAddress Address of the NFT collection
    /// @param _serials Array of serial numbers to delegate
    function delegateNFT(
        address _delegator,
        address _collectionAddress,
        uint256[] memory _serials
    ) external;

    /// @notice Revoke NFT delegation rights
    /// @param _collectionAddress Address of the NFT collection
    /// @param _serials Array of serial numbers to revoke delegation for
    function revokeDelegateNFT(
        address _collectionAddress,
        uint256[] memory _serials
    ) external;
}
