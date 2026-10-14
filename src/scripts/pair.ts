import { ApiClient } from '../api/client';
import * as readline from 'readline';

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  console.log('--- TicketAssist Worker Pairing Utility ---');
  const machineCode = (await question('Enter Machine Code (e.g. PC-003): ')) || 'PC-003';
  const machineName = (await question('Enter Machine Name (e.g. Salem Worker PC): ')) || 'Salem Worker PC';

  const client = new ApiClient();
  const reg = await client.registerMachine(machineCode, machineName, '1.0.0');

  console.log('\n=======================================');
  console.log(`Generated Pairing Code: ${reg.pairingCode}`);
  console.log(`Machine Code: ${reg.machineCode}`);
  console.log('Enter this pairing code in Admin Dashboard -> Fleet -> Pair Machine.');
  console.log('=======================================\n');

  rl.close();
}

main().catch(console.error);
