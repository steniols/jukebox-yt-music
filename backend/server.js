const { assertRequiredEnv } = require("./src/config/env");
const { getKey } = require("./src/app/services/tokenCipher");

assertRequiredEnv();
getKey();

const app = require("./src/config/express");

const port = process.env.PORT || 8003;

app.listen(port, () => {
  console.log(`server has started on port ${port}`);
});
