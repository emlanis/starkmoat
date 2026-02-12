global MERKLE_DEPTH: u32 = 8;

fn hash_leaf(secret: Field) -> Field {
    std::hash::pedersen_hash([secret])
}

fn hash_pair(left: Field, right: Field) -> Field {
    std::hash::pedersen_hash([left, right])
}

fn action_hash(domain_separator: Field, tx_hash: Field) -> Field {
    hash_pair(domain_separator, tx_hash)
}

fn compute_merkle_root(
    leaf: Field,
    siblings: [Field; MERKLE_DEPTH],
    path_indices: [bool; MERKLE_DEPTH],
) -> Field {
    let mut current = leaf;

    for i in 0..MERKLE_DEPTH {
        if !path_indices[i] {
            current = hash_pair(current, siblings[i]);
        } else {
            current = hash_pair(siblings[i], current);
        }
    }

    current
}

// Private:
// - secret
//
// Public:
// - merkle_root
// - siblings/path_indices (Merkle proof path)
// - tx_hash + domain_separator (action binding)
//
// Public output:
// - nullifier = H(secret, H(domain_separator, tx_hash))
fn main(
    secret: Field,
    merkle_root: pub Field,
    siblings: pub [Field; MERKLE_DEPTH],
    path_indices: pub [bool; MERKLE_DEPTH],
    tx_hash: pub Field,
    domain_separator: pub Field,
) -> pub Field {
    let leaf = hash_leaf(secret);
    let computed_root = compute_merkle_root(leaf, siblings, path_indices);
    assert(computed_root == merkle_root, "invalid Merkle proof");

    let bound_action_hash = action_hash(domain_separator, tx_hash);
    hash_pair(secret, bound_action_hash)
}

#[test]
fn test_valid_membership_and_nullifier() {
    let secret = 12345;
    let siblings = [11, 22, 33, 44, 55, 66, 77, 88];
    let path_indices = [false, true, false, true, false, true, false, true];
    let tx_hash = 999;
    let domain_separator = 42;

    let root = compute_merkle_root(hash_leaf(secret), siblings, path_indices);
    let expected_nullifier = hash_pair(secret, action_hash(domain_separator, tx_hash));
    let out_nullifier = main(secret, root, siblings, path_indices, tx_hash, domain_separator);

    assert(out_nullifier == expected_nullifier);
}

#[test(should_fail)]
fn test_rejects_wrong_root() {
    let secret = 12345;
    let siblings = [11, 22, 33, 44, 55, 66, 77, 88];
    let path_indices = [false, true, false, true, false, true, false, true];
    let tx_hash = 999;
    let domain_separator = 42;

    let correct_root = compute_merkle_root(hash_leaf(secret), siblings, path_indices);
    let wrong_root = correct_root + 1;

    let _ = main(secret, wrong_root, siblings, path_indices, tx_hash, domain_separator);
}

#[test]
fn test_nullifier_changes_with_action_hash() {
    let secret = 12345;
    let first_siblings = [11, 22, 33, 44, 55, 66, 77, 88];
    let first_path_indices = [false, true, false, true, false, true, false, true];
    let second_siblings = [11, 22, 33, 44, 55, 66, 77, 88];
    let second_path_indices = [false, true, false, true, false, true, false, true];
    let domain_separator = 42;

    let first_root = compute_merkle_root(hash_leaf(secret), first_siblings, first_path_indices);
    let second_root = compute_merkle_root(hash_leaf(secret), second_siblings, second_path_indices);
    let first = main(secret, first_root, first_siblings, first_path_indices, 100, domain_separator);
    let second = main(
        secret,
        second_root,
        second_siblings,
        second_path_indices,
        101,
        domain_separator,
    );

    assert(first != second);
}
