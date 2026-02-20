const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function test() {
    console.log('Fetching players...');
    const { data, error } = await supabase.from('players').select('*');

    if (error) {
        console.error('Error:', error);
        return;
    }

    const squad = data.filter(p => p.handicap !== null).sort((a, b) => a.handicap - b.handicap);

    console.log(`Found ${squad.length} players with handicaps.`);

    console.log('\n--- Simulated Team Selection (Snake Draft 1,3,6) ---');
    squad.forEach((p, index) => {
        const rank = index + 1;
        // Logic: 1 (T1), 2 (T2), 3 (T2), 4 (T1)...
        // T1 if rank % 4 is 1 or 0
        const team = (rank % 4 === 1 || rank % 4 === 0) ? 1 : 2;
        console.log(`Rank ${rank}: ${p.name.padEnd(20)} (HCP: ${p.handicap}) -> Team ${team}`);
    });
}

test();
