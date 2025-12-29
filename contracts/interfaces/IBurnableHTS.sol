// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title IBurnableHTS - Interface for Burnable Hedera Token Service
/// @author stowerling.eth / stowerling.hbar
/// @notice Interface for burning HTS tokens
interface IBurnableHTS {
    /// @notice Burn a specified amount of tokens
    /// @param token Address of the token to burn
    /// @param amount Amount of tokens to burn
    /// @return responseCode HTS response code indicating success or failure
    function burn(
        address token,
        uint32 amount
    ) external returns (int256 responseCode);
}
