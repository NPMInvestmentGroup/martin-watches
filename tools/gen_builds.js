// Regenerates builds.json + part thumbnails only (no photo gallery). Needs the 'sharp' npm package:
//   npm i --prefix /tmp/tools sharp      (any folder; set NODE_PATH to its node_modules if not /tmp/tools)
process.env.BUILDER_ONLY = '1';
process.env.NODE_PATH = [process.env.NODE_PATH, '/tmp/tools/node_modules'].filter(Boolean).join(require('path').delimiter);
require('module').Module._initPaths();
require('../scripts/build-gallery.js');
