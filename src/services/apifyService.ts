import { ApifyClient } from 'apify-client';

const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

const ACTOR_ID = process.env.APIFY_ACTOR_ID || 'pIyH7237rHZBxoO7q';

export async function runApifyScraper(queries: string[]) {
    if (!process.env.APIFY_API_TOKEN) {
        throw new Error('APIFY_API_TOKEN not configured');
    }

    // Start the actor and wait for it to finish
    const run = await client.actor(ACTOR_ID).start({
        queries,
        // Add other default inputs if necessary based on the actor's requirements
    });

    return run;
}

export async function getApifyRunStatus(runId: string) {
    return await client.run(runId).get();
}

export async function getApifyRunResults(runId: string) {
    const run = await client.run(runId).get();
    if (!run) throw new Error('Run not found');
    
    const { defaultDatasetId } = run;
    const { items } = await client.dataset(defaultDatasetId).listItems();
    
    return items;
}
