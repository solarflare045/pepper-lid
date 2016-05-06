var _ = require('lodash');
var async = require('async-q');
var config = require('config');
var cron = require('cron');
var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');
var request = require('request-promise');
var winston = require('winston');
var youtube = require('youtube-mp3-downloader');

Promise.config({
  warnings: false
});

function doWork() {
  winston.info('Starting download job...');
  return readPage()
    .then(function(videos) {
      return async.eachSeries(videos, function(video) {
        var fileName = video.videoId + '.mp3';
        try {
          fs.statSync(path.join(config.get('destination'), fileName));
          return;
        } catch (err) {
          // If you reached here, the file does not exist.
        }

        winston.info('Downloading %s [%s]...', video.title, fileName);

        return new Promise(function(resolve, reject) {
          var YD = new youtube({
            ffmpegPath: config.get('ffmpeg.location'),
            outputPath: config.get('destination'),
            youtubeVideoQuality: 'highest'
          });

          YD.on('finished', function(data) {
            winston.info('Downloaded %s.', fileName);
            return resolve(data);
          });

          YD.on('error', function(error) {
            return reject(error);
          });

          YD.download(video.videoId, fileName);
        });
      });
    })
    .then(function() {
      winston.info('Download job complete.');
    })
    .catch(function(error) {
      winston.error('Download error', error.stack || error);
    });
}

function readPage(pageToken) {
  return request.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    json: true,
    qs: {
      key: config.get('youtube.apiKey'),
      maxResults: 10,
      pageToken: pageToken,
      part: 'snippet',
      playlistId: config.get('youtube.playlistId')
    }
  }).then(function(results) {
    var videos = _.map(results.items, function(item) {
      return {
        title: _.get(item, 'snippet.title'),
        videoId: _.get(item, 'snippet.resourceId.videoId')
      };
    });

    if (!results.pageInfo.nextPageToken)
      return videos;

    return readPage(results.pageInfo.nextPageToken)
      .then(function(more) {
        return _.concat(videos, more);
      });
  });
}

var queue = async.queue(doWork, 1);
var job = new cron.CronJob({
  cronTime: config.get('cron.frequency'),
  onTick: function() {
    queue.push({});
  },
  start: true,
  runOnInit: true
});
