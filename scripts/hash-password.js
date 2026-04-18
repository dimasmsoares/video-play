const { hashPassword } = require("../server");

const password = process.argv[2];

if (!password) {
  console.error("Use: npm run hash-password -- sua-senha-forte");
  process.exit(1);
}

console.log(hashPassword(password));
