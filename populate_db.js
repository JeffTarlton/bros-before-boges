const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const roster = [
    { name: 'Colby Gibson', ghin: null, handicap: 5.0 },
    { name: 'Westin Tucker', ghin: null, handicap: 5.6 },
    { name: 'Zac Taylor', ghin: null, handicap: 3.5 },
    { name: 'Derrick Merchant', ghin: null, handicap: 10.0 },
    { name: 'Jeff Tarlton', ghin: '2360395', handicap: 9.0 },
    { name: 'Kelly Dennard', ghin: null, handicap: 8.4 },
    { name: 'Dillon Griffin', ghin: null, handicap: 14.4 },
    { name: 'Andy Mazzolini', ghin: null, handicap: 15.0 },
    { name: 'Jayme McCall', ghin: null, handicap: 7.1 },
    { name: 'David Owens', ghin: null, handicap: 9.3 },
    { name: 'Parker Davidson', ghin: null, handicap: 8.0 },
    { name: 'Tripp Harris', ghin: null, handicap: null },
    { name: 'Ty Buis', ghin: null, handicap: 17.0 }
];

async function run() {
    console.log('Inserting players...');
    const { data, error } = await supabase
        .from('players')
        .upsert(roster.map(p => ({
            name: p.name,
            ghin: p.ghin,
            handicap: p.handicap,
            status: 'confirmed'
        })))
        .select();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Success! Players inserted:', data.length);
    }
}

run();
