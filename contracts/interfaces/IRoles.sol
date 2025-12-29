// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title IRoles
 * @author Stowerling
 * @notice Interface for role-based access control definitions
 */
interface IRoles {
    enum Role {
        Admin,
        GasStationAuthorizer,
        GasStationContractUser,
        AdminOrCreator
    }

    error PermissionDenied(address _caller, Role _role);
}
