
const path = require('path');
const dotenv = require('dotenv');

const args = process.argv.slice(2);
const isStaging = args.includes('--staging');

if (isStaging) {
    dotenv.config({ path: path.resolve(__dirname, '../../.env.staging'), override: true });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, '../../staging-service-account.json');
} else {
    dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
}
