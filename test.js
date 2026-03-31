import { resolveStream } from './resolver.js';

async function main() {
    console.log("=== P-Stream Final Resolver Validation Suite ===");
    console.log("Testing Movie (Inception ID 27205)...");
    
    try {
        const stream = await resolveStream(27205, 'movie', 1, 1, 'vixsrc');
        console.log("SUCCESS:", JSON.stringify(stream, null, 2));
    } catch (e) {
        console.error("FAIL:", e.message);
    }
}
main();
