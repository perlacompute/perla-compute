/** Shared Perla branding and feature configuration. */
export const brand = {
    name: 'Perla',
    fullName: 'Perla Compute',
    initials: 'PC',
    tagline: 'Your GPU. Your contribution.',
    description: 'GPU mining for AI compute, native proof verification, and contribution accounting on Robinhood.',
    wordmarkSuffix: 'COMPUTE',
    features: { inference: false, modelCatalog: false, developerApi: false },
    phase: 'Validation release',
    phaseLabel: 'GPU validation pending',
    network: { name: 'Robinhood Testnet', chainId: 46630, chainHex: '0xb626', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' },
    token: { address: null as string | null, ticker: 'PERL' as string | null, launchpad: 'https://www.ponsfamily.com/launchpad/' },
} as const;
export const modelCatalog = [
    { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama 3.1', size: '8B', family: 'Meta', letter: 'L', tone: 'blue', category: 'General', description: 'An approachable starting point for everyday conversations, writing, and lightweight applications.', tags: ['Chat', 'Writing', 'General purpose'] },
    { id: 'Qwen/Qwen3-8B', name: 'Qwen3', size: '8B', family: 'Qwen', letter: 'Q', tone: 'violet', category: 'Reasoning', description: 'Explore reasoning and multilingual workflows with an open model configuration.', tags: ['Reasoning', 'Multilingual', 'Code'] },
    { id: 'google/gemma-3-12b-it', name: 'Gemma 3', size: '12B', family: 'Google', letter: 'G', tone: 'sand', category: 'General', description: 'A reference configuration for building focused assistants and knowledge workflows.', tags: ['Chat', 'Assistants', 'Open weights'] },
    { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', name: 'DeepSeek R1', size: '7B', family: 'DeepSeek', letter: 'D', tone: 'teal', category: 'Reasoning', description: 'A compact distilled model configuration for exploring step-by-step reasoning.', tags: ['Reasoning', 'Math', 'Code'] },
] as const;
export type Model = typeof modelCatalog[number];
