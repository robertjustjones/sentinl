/*
 * Copyright 2016, Lorenzo Mangani (lorenzo.mangani@gmail.com)
 * Copyright 2015, Rao Chenlin (rao.chenlin@gmail.com)
 *
 * This file is part of Sentinl (http://github.com/sirensolutions/sentinl)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import later from 'later';
import _ from 'lodash';
import masterRoute from './server/routes/routes';
import getScheduler from './server/lib/scheduler';
import helpers from './server/lib/helpers';
import getElasticsearchClient from './server/lib/get_elasticsearch_client';
import getConfiguration from './server/lib/get_configuration';
import fs from 'fs';
import phantom from './server/lib/phantom';

import userIndexMappings from './server/mappings/user_index';
import coreIndexMappings from './server/mappings/core_index';
import alarmIndexMappings from './server/mappings/alarm_index';
import templateMappings from './server/mappings/template';

import watchConfiguration from './server/lib/saved_objects/watch';
import scriptConfiguration from './server/lib/saved_objects/script';
import userConfiguration from './server/lib/saved_objects/user';

/**
* Initializes Sentinl app.
*
* @param {object} server - Kibana server.
*/
const init = _.once((server) => {
  const config = getConfiguration(server);
  const scheduler = getScheduler(server);

  if (fs.existsSync('/etc/sentinl.json')) {
    server.plugins.sentinl.status.red('Setting configuration values in /etc/sentinl.json is not supported anymore, please copy ' +
                                      'your Sentinl configuration values to config/kibi.yml or config/kibana.yml, ' +
                                      'remove /etc/sentinl.json and restart.');
    return;
  }

  server.log(['status', 'info', 'Sentinl'], 'Sentinl Initializing');

  // Object to hold different runtime values.
  server.sentinlStore = {
    schedule: {}
  };

  // Install PhantomJS lib. The lib is needed to take screenshots by report action.
  const phantomPath = _.has(config, 'settings.report.phantomjs_path') ? config.settings.report.phantomjs_path : undefined;
  phantom.install(phantomPath)
  .then((phantomPackage) => {
    server.log(['status', 'info', 'Sentinl', 'report'], `Phantom installed at ${phantomPackage.binary}`);
    server.expose('phantomjs_path', phantomPackage.binary);
  })
  .catch((err) => server.log(['status', 'error', 'Sentinl', 'report'], `Failed to install phantomjs: ${err}`));

  // Load Sentinl routes.
  masterRoute(server);

  // Create indexes and doc types with mappings.
  if (server.plugins.saved_objects_api) { // Kibi: savedObjectsAPI.
    _.forEach([watchConfiguration, scriptConfiguration, userConfiguration], (schema) => {
      server.plugins.saved_objects_api.registerType(schema);
    });

    config.es.default_index = '.kibi';
    config.es.type = 'sentinl-watcher';
    helpers.putMapping(server, config, config.es.default_index, config.es.type, coreIndexMappings);
  } else { // Kibana.
    helpers.createIndex(server, config, config.es.default_index, config.es.type, coreIndexMappings);
  }
  helpers.putMapping(server, config, config.es.default_index, config.es.script_type, templateMappings);
  helpers.createIndex(server, config, config.es.alarm_index, config.es.alarm_type, alarmIndexMappings, 'alarm');

  if (!server.plugins.kibi_access_control && config.settings.authentication.enabled) {
    helpers.createIndex(server, config, config.settings.authentication.user_index,
      config.settings.authentication.user_type, userIndexMappings);
  }

  // Schedule watchers execution.
  const sched = later.parse.recur().on(25,55).second();
  const handleWatchers = later.setInterval(() => scheduler.doalert(server), sched);
});

export default function (server, options) {

  let status = server.plugins.elasticsearch.status;
  if (status && status.state === 'green') {
    init(server);
  } else {
    status.on('change', () => {
      if (server.plugins.elasticsearch.status.state === 'green') {
        init(server);
      }
    });
  }

};
