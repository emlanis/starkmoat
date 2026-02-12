#[starknet::interface]
pub trait IStarkmoatRegistry<TContractState> {
    fn set_root(ref self: TContractState, new_root: felt252);
    fn get_current_root(self: @TContractState) -> felt252;
    fn is_root_accepted(self: @TContractState, root: felt252) -> bool;
    fn get_admin(self: @TContractState) -> starknet::ContractAddress;
}

#[starknet::contract]
mod StarkmoatRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        current_root: felt252,
        accepted_roots: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        RootUpdated: RootUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct RootUpdated {
        previous_root: felt252,
        new_root: felt252,
        updated_by: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_root: felt252) {
        let caller = get_caller_address();
        assert(initial_root != 0, 'initial root is zero');

        self.admin.write(caller);
        self.current_root.write(initial_root);
        self.accepted_roots.write(initial_root, true);

        self.emit(
            Event::RootUpdated(
                RootUpdated { previous_root: 0, new_root: initial_root, updated_by: caller },
            ),
        );
    }

    #[abi(embed_v0)]
    impl StarkmoatRegistryImpl of super::IStarkmoatRegistry<ContractState> {
        fn set_root(ref self: ContractState, new_root: felt252) {
            assert(new_root != 0, 'root is zero');

            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'only admin');

            let previous_root = self.current_root.read();
            assert(new_root != previous_root, 'root unchanged');

            self.current_root.write(new_root);
            self.accepted_roots.write(new_root, true);

            self.emit(
                Event::RootUpdated(
                    RootUpdated { previous_root, new_root, updated_by: caller },
                ),
            );
        }

        fn get_current_root(self: @ContractState) -> felt252 {
            self.current_root.read()
        }

        fn is_root_accepted(self: @ContractState, root: felt252) -> bool {
            self.accepted_roots.read(root)
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }
    }
}
