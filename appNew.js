require('dotenv').config();
var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var handlebars = require('express-handlebars');
var nconf = require('nconf');
var session = require('express-session');
var moment = require('moment');
var fs = require('fs');

// Load routes
var indexRoute = require('./routes/index');
var apiRoute = require('./routes/api');
var usersRoute = require('./routes/users');
var configRoute = require('./routes/config');
var docRoute = require('./routes/document');
var dbRoute = require('./routes/database');
var collectionRoute = require('./routes/collection');

// Set base directory
var dir_base = __dirname;
if (process.versions['electron']) {
  dir_base = path.join(process.resourcesPath.toString(), 'app/');
}

var app = express();

// Setup translation
var i18n = new (require('i18n-2'))({
  locales: ['zh-cn', 'en', 'de', 'es', 'ru', 'it'],
  directory: path.join(dir_base, 'locales/')
});

// Setup DB for server stats
var Datastore = require('nedb');
var db = new Datastore({ filename: path.join(dir_base, 'data/dbStats.db'), autoload: true });

// View engine setup
app.set('views', path.join(dir_base, 'views/'));
app.engine('hbs', handlebars({ extname: 'hbs', defaultLayout: path.join(dir_base, 'views/layouts/layout.hbs') }));
app.set('view engine', 'hbs');

// Check existence of backups dir, create if not present
if (!fs.existsSync(path.join(dir_base, 'backups'))) fs.mkdirSync(path.join(dir_base, 'backups'));

// Helpers for handlebars
handlebars = handlebars.create({
  helpers: {
    __: function (value) {
      return i18n.__(value);
    },
    toJSON: function (object) {
      return JSON.stringify(object);
    },
    niceBool: function (object) {
      if (object === undefined) return 'No';
      return object ? 'Yes' : 'No';
    },
    app_context: function () {
      return nconf.stores.app.get('app:context') ? '/' + nconf.stores.app.get('app:context') : '';
    },
    ifOr: function (v1, v2, options) {
      return (v1 || v2) ? options.fn(this) : options.inverse(this);
    },
    ifNotOr: function (v1, v2, options) {
      return (v1 || v2) ? options.inverse(this) : options.fn(this);
    },
    formatBytes: function (bytes) {
      if (bytes === 0) return '0 Byte';
      var k = 1000, dm = 2 + 1 || 3, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
      var i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toPrecision(dm) + ' ' + sizes[i];
    },
    formatDuration: function (time) {
      return moment.duration(time, 'seconds').humanize();
    }
  }
});

// Setup nconf to read from files and environment
var dir_config = path.join(dir_base, 'config/');
var config_connections = path.join(dir_config, 'config.json');
var config_app = path.join(dir_config, 'app.json');

// Ensure config directory and files exist
if (!fs.existsSync(dir_config)) fs.mkdirSync(dir_config);

// Initialize app configuration
var configApp = {
  app: {}
};
if (process.env.HOST) configApp.app.host = process.env.HOST;
if (process.env.PORT) configApp.app.port = process.env.PORT;
if (process.env.PASSWORD) configApp.app.password = process.env.PASSWORD;
if (process.env.LOCALE) configApp.app.locale = process.env.LOCALE;
if (process.env.CONTEXT) configApp.app.context = process.env.CONTEXT;
if (process.env.MONITORING) configApp.app.monitoring = process.env.MONITORING;

fs.writeFileSync(config_app, JSON.stringify(configApp, null, 2));

// Initialize connections configuration
var configConnection = {
  connections: {}
};
if (process.env.CONN_NAME && process.env.DB_HOST) {
  var connectionString = `mongodb://${process.env.DB_HOST}:${process.env.DB_PORT || 27017}`;
  if (process.env.DB_USERNAME && process.env.DB_PASSWORD) {
    connectionString = `mongodb://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT || 27017}`;
    if (process.env.DB_NAME) connectionString += `/${process.env.DB_NAME}`;
  }
  configConnection.connections[process.env.CONN_NAME] = {
    connection_options: {},
    connection_string: connectionString
  };
}
if (!fs.existsSync(config_connections) || fs.readFileSync(config_connections, 'utf8') === '{}') {
  fs.writeFileSync(config_connections, JSON.stringify(configConnection));
}

// Ensure config files are not empty
if (fs.existsSync(config_app) && fs.readFileSync(config_app, 'utf8') === '') {
  fs.writeFileSync(config_app, '{}', 'utf8');
}
if (fs.existsSync(config_connections) && fs.readFileSync(config_connections, 'utf8') === '') {
  fs.writeFileSync(config_connections, '{}', 'utf8');
}

// Setup nconf stores
nconf.add('connections', { type: 'file', file: config_connections });
nconf.add('app', { type: 'file', file: config_app });

// Set app defaults
var app_host = process.env.HOST || 'localhost';
var app_port = process.env.PORT || 1234;

// Override app defaults with nconf values
app_host = nconf.stores.app.get('app:host') || app_host;
app_port = nconf.stores.app.get('app:port') || app_port;
if (nconf.stores.app.get('app:locale')) {
  i18n.setLocale(nconf.stores.app.get('app:locale'));
}

app.locals.app_host = app_host;
app.locals.app_port = app_port;

// Setup app context
var app_context = nconf.stores.app.get('app:context') ? '/' + nconf.stores.app.get('app:context') : '';

// Middleware setup
app.use(logger('dev'));
app.use(bodyParser.json({ limit: '16mb' }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: true } // Set secure to true if using HTTPS
}));

// Static file setup
app.use(app_context + '/static', express.static(path.join(dir_base, 'public/')));
app.use(app_context + '/font-awesome', express.static(path.join(dir_base, 'node_modules/font-awesome/')));
app.use(app_context + '/jquery', express.static(path.join(dir_base, 'node_modules/jquery/dist/')));
app.use(app_context + '/bootstrap', express.static(path.join(dir_base, 'node_modules/bootstrap/dist/')));
app.use(app_context + '/css', express.static(path.join(dir_base, 'public/css')));
app.use(app_context + '/fonts', express.static(path.join(dir_base, 'public/fonts')));
app.use(app_context + '/js', express.static(path.join(dir_base, 'public/js')));
app.use(app_context + '/favicon.ico', express.static(path.join(dir_base, 'public/favicon.ico')));

// Make stuff accessible to our router
app.use((req, res, next) => {
  req.nconf = nconf.stores;
  req.handlebars = handlebars;
  req.i18n = i18n;
  req.app_context = app_context;
  req.db = db;
  next();
});

// Add context to route if required
if (app_context) {
  app.use(app_context, apiRoute);
  app.use(app_context, usersRoute);
  app.use(app_context, configRoute);
  app.use(app_context, docRoute);
  app.use(app_context, dbRoute);
  app.use(app_context, collectionRoute);
  app.use(app_context, indexRoute);
} else {
  app.use('/', apiRoute);
  app.use('/', usersRoute);
  app.use('/', configRoute);
  app.use('/', docRoute);
  app.use('/', dbRoute);
  app.use('/', collectionRoute);
  app.use('/', indexRoute);
}

// Catch 404 and forward to error handler
app.use((req, res, next) => {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// Development error handler
if (app.get('env') === 'development') {
  app.use((err, req, res, next) => {
    console.log(err.stack);
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err,
      helpers: handlebars.helpers
    });
  });
}

// Production error handler
app.use((err, req, res, next) => {
  console.log(err.stack);
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {},
    helpers: handlebars.helpers
  });
});

// Add connections to the connection pool
const initConnections = async () => {
  try {
    const connection_list = nconf.stores.connections.get('connections');
    const connPool = require('./connections');
    const monitoring = require('./monitoring');
    app.locals.dbConnections = null;

    for (const [key, value] of Object.entries(connection_list)) {
      try {
        await connPool.addConnection({ connName: key, connString: value.connection_string, connOptions: value.connection_options }, app);
      } catch (err) {
        console.error(`Error adding connection ${key}: ${err.message}`);
        delete connection_list[key];
      }
    }

    app.listen(app_port, app_host, () => {
      console.log(`adminMongo listening on host: http://${app_host}:${app_port}${app_context}`);
      app.emit('startedAdminMongo');

      if (nconf.stores.app.get('app:monitoring') !== false) {
        monitoring.serverMonitoring(db, app.locals.dbConnections);
        setInterval(() => monitoring.serverMonitoring(db, app.locals.dbConnections), 30000);
      }
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error starting adminMongo: Port ${app_port} already in use, choose another`);
      } else {
        console.error(`Error starting adminMongo: ${err}`);
        app.emit('errorAdminMongo');
      }
    });

  } catch (err) {
    console.error(`Error initializing connections: ${err.message}`);
  }
};

initConnections();

module.exports = app;
