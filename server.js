var path = require('path');
var compression = require('compression');
var express = require("express");

var app = express();
var port = process.env.PORT || 3000;

app.use(compression({filter: () => true}));
app.use(express.static('public'));
app.get('/z.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'z.js'));
});
app.get('/zork1.z5', (req, res) => {
  res.sendFile(path.join(__dirname, 'zork1.z5'));
});

app.listen(port, function() {
  console.log(`Listening on port ${this.address().port}`);
});
