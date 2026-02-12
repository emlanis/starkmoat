use starknet::ContractAddress;

use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use starkmoat_contracts::IStarkmoatRegistryDispatcher;
use starkmoat_contracts::IStarkmoatRegistryDispatcherTrait;
use starkmoat_contracts::IStarkmoatRegistrySafeDispatcher;
use starkmoat_contracts::IStarkmoatRegistrySafeDispatcherTrait;

fn deploy_registry(initial_root: felt252) -> ContractAddress {
    let mut constructor_calldata = ArrayTrait::new();
    constructor_calldata.append(initial_root);

    let contract = declare("StarkmoatRegistry").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
    contract_address
}

#[test]
fn test_constructor_sets_initial_root() {
    let contract_address = deploy_registry(111);

    let dispatcher = IStarkmoatRegistryDispatcher { contract_address };

    assert(dispatcher.get_current_root() == 111, 'invalid current root');
    assert(dispatcher.is_root_accepted(111), 'initial root not accepted');
    assert(!dispatcher.is_root_accepted(999), 'unexpected accepted root');
}

#[test]
fn test_set_root_accepts_new_root_and_keeps_history() {
    let contract_address = deploy_registry(111);

    let dispatcher = IStarkmoatRegistryDispatcher { contract_address };

    dispatcher.set_root(222);

    assert(dispatcher.get_current_root() == 222, 'root update failed');
    assert(dispatcher.is_root_accepted(222), 'new root not accepted');
    assert(dispatcher.is_root_accepted(111), 'old root should remain accepted');
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_root_rejects_zero_root() {
    let contract_address = deploy_registry(111);

    let safe_dispatcher = IStarkmoatRegistrySafeDispatcher { contract_address };

    match safe_dispatcher.set_root(0) {
        Result::Ok(_) => core::panic_with_felt252('should have panicked'),
        Result::Err(panic_data) => {
            assert(*panic_data.at(0) == 'root is zero', *panic_data.at(0));
        }
    };
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_root_rejects_same_root() {
    let contract_address = deploy_registry(111);

    let safe_dispatcher = IStarkmoatRegistrySafeDispatcher { contract_address };

    match safe_dispatcher.set_root(111) {
        Result::Ok(_) => core::panic_with_felt252('should have panicked'),
        Result::Err(panic_data) => {
            assert(*panic_data.at(0) == 'root unchanged', *panic_data.at(0));
        }
    };
}

#[test]
#[feature("safe_dispatcher")]
fn test_constructor_rejects_zero_root() {
    let mut constructor_calldata = ArrayTrait::new();
    constructor_calldata.append(0);

    let contract = declare("StarkmoatRegistry").unwrap().contract_class();

    match contract.deploy(@constructor_calldata) {
        Result::Ok(_) => core::panic_with_felt252('should have panicked'),
        Result::Err(panic_data) => {
            assert(*panic_data.at(0) == 'initial root is zero', *panic_data.at(0));
        }
    }
}
