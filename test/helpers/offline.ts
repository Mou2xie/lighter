// Every runtime test imports this guard. Test-specific fetch mocks are restored
// to this implementation, never to the real network transport.
globalThis.fetch = async () => {
    throw new Error("Network access is disabled in offline tests. Provide a test-local HTTP fixture.");
};

export {};
