Log = new Meteor.Collection('Log');
Log._ensureIndex({ tr: 1});
Log._ensureIndex({ ts: 1});
Log._ensureIndex({ rel: 1});

Openki = {};

/** Record a new entry to the log
  *
  * @param  {String} track   - type of log entry
  * @param  {String} rel     - related ID, may be a list
  * @param  {Object} body    - log body depending on track
  */
Openki.Log = function(track, rel, body) {
	check(track, String);
	check(rel, Match.Maybe(String));
	check(body, Object);
	var entry =
		{ tr: track
		, ts: new Date()
		, body: body
		};

	if (rel) {
		entry.rel = rel;
	}

	Log.insert(entry);
};

Openki.Log.Notification = {};

/** Record the intent to send event notifications
  *
  * @param      {ID} eventID   - event to announce
  * @param {Boolean} isNew     - whether the event is a new one
  */
Openki.Log.Notification.Event = function(eventId, isNew) {
	check(eventId, String);
	var event = Events.findOne(eventId);
	if (!event) throw new Meteor.Error("No event for" + eventId);

	// What do we do when we receive an event which is not attached to a course?
	// For now when we don't have a course we just go through the motions but
	// the recipient list will be empty.
	var course = false;
	if (event.courseId) course = Courses.findOne(event.courseId);

	var entry = {};
	entry.new = isNew;
	entry.eventId = event._id;

	// The list of recipients is built right away so that only course members
	// at the time of event creation will get the notice even if sending is
	// delayed.
	entry.recipients = [];
	if (course) {
		entry.recipients = _.pluck(course.members, 'user');
		entry.courseId = course._id;
	}

	Openki.Log('notification.event', null, entry);
};


/** Record the result of a notification delivery attempt to the log
  * @param      {ID} rel       - reference to the notification log-entry
  * @param {Boolean} sent      - whether the notification was sent
  * @param      {ID} recipient - target user ID
  * @param  {String} message   - generated message (or null if we didn't get
  *                              that far)
  * @param  {String} reason    - why this log entry was recorded
  */
Openki.Log.Notification.Event.Result = function(rel, sent, recipient, message, reason) {
	check(rel, String);
	check(sent, Boolean);
	check(recipient, String);
	check(message, Match.Maybe(Object));
	var entry = {
		sent: sent,
		recipient: recipient,
		message: message,
		reason: reason
	};

	Openki.Log('notification.event.result', rel, entry);
};

Openki.Log.Notification.Event.handler = function(entry) {
	// Find out for which recipients sending has already been attempted.
	var concluded = {};


	Log.find(
		{ tr: 'notification.event.result'
		, rel: entry._id
		}
	).forEach(function(result) {
		concluded[result.body.recipient] = true;
	});

	var event = Events.findOne(entry.body.eventId);
	var course = false;
	if (event && event.courseId) {
		course = Courses.findOne(event.courseId);
	}

	_.each(entry.body.recipients, function(recipient) {
		if (!concluded[recipient]) {
			var mail = null;

			try {
				if (!event) throw "Event does not exist (0.o)";
				if (!course) throw "Course does not exist (0.o)";

				var user = Meteor.users.findOne(recipient);
				if (!user) throw "Recipient does not exist (0.o)";

				if (!user.emails || !user.emails[0] || !user.emails[0].address) {
					throw "Recipient has no email address registered";
				}

				var	email = user.emails[0];
				var address = email.address;

				var userLocale = user.profile && user.profile.locale || 'en';
				var startMoment = moment(event.start);
				startMoment.locale(userLocale);
				var endMoment = moment(event.end);
				endMoment.locale(userLocale);

				var subjectvars =
					{ TITLE: event.title.substr(0,30)
					, DATE: startMoment.format('LL')
					};

				var vars =
					{ event: event
					, course: course
					, eventDate: startMoment.format('LL')
					, eventStart: startMoment.format('LT')
					, eventEnd: startMoment.format('LT')
					, locale: userLocale
					, new: entry.new
					};

				var message = SSR.render("notificationEventMail", vars);

				var subjectPrefix = '['+Accounts.emailTemplates.siteName+'] ';
				var subject;
				if (entry.new) {
					subject = mf('notification.event.mail.subject.new', subjectvars, "On {DATE}: {TITLE}");
				} else {
					subject = mf('notification.event.mail.subject.changed', subjectvars, "Fixed {DATE}: {TITLE}");
				}

				mail =
					{ from: Accounts.emailTemplates.from
					, to: address
					, subject: subjectPrefix + subject
					, html: message
					};

				Email.send(mail);

				Openki.Log.Notification.Event.Result(entry._id, true, recipient, mail, "success");
			}
			catch(e) {
				var reason = e;
				if (typeof e == 'object' && 'toJSON' in e) reason = e.toJSON();
				Openki.Log.Notification.Event.Result(entry._id, false, recipient, mail, reason);
			}

		}
	});
};


/** Watch the Log for event notifications
*/
Meteor.startup(function() {
	/*
   * Main Blaze regular helper / block helper, calls mf() with correct
   * parameters.  On the client, mf() honors the Session locale if none is
   * manually specified here (see messageformat.js), making this a reactive
   * data source.
   */
  Blaze.Template.registerHelper("mf", function(key, message, params) {
    if (arguments[arguments.length-1] instanceof Spacebars.kw) {

      var result;
      var _HTML = params && (params._HTML || params._html);

      message = params ? message : null;
      params = params ? params.hash : {};

      result = mf(key, params, message, params ? params.LOCALE : null);
      return _HTML ?
        Spacebars.SafeString(msgfmt.sanitizeHTML(result, _HTML)) : result;

    } else {

      // Block helpers expects a template to be returned
      return mfTpl;

    }

  });

	SSR.compileTemplate('notificationEventMail', Assets.getText('mails/notificationEventMail.html'));

	// To avoid sending stale notifications, only consider records added in the
	// last hours. This way, if the server should have failed for a longer time,
	// no notifications will go out.
	var gracePeriod = new Date();
	gracePeriod.setHours(gracePeriod.getHours() - 12);

	// The Log is append-only so we only watch for additions
	Log.find({ tr: 'notification.event', ts: { $gte: gracePeriod } }).observe({
		added: Openki.Log.Notification.Event.handler
	});
});