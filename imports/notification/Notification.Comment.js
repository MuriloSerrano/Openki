export default notificationComment = {};
import '/imports/collections/Log.js';
import '/imports/StringTools.js';

/** Record the intent to send event notifications
  *
  * @param      {ID} commentID - ID for the CourseDiscussions collection
  */
notificationComment.record = function(commentId) {
	check(commentId, String);
	var comment = CourseDiscussions.findOne(commentId);
	if (!comment) throw new Meteor.Error("No CourseDiscussion entry for " + commentId);

	var course = Courses.findOne(comment.courseId);
	if (!course) throw new Meteor.Error("No course entry for " + commentId);

	var body = {};
	body.commentId = comment._id;
	body.recipients = [];
	body.recipients = _.pluck(course.membersWithRole('team'), 'user');

	body.model = 'Comment';

	Log.record('Notification.Send', [course._id, comment._id], body);
};


notificationComment.Model = function(entry) {
	var comment = CourseDiscussions.findOne(entry.body.commentId);
	var course = false;
	var commenter = false;

	if (comment) {
		course = Courses.findOne(comment.courseId);
		commenter = Meteor.users.findOne(comment.userId);
	}

	return {
		vars: function(userLocale) {
			if (!comment) throw "Comment does not exist (0.o)";
			if (!course) throw "Course does not exist (0.o)";

			var subjectvars =
				{ COURSE: StringTools.truncate(course.name, 10)
				, TITLE: StringTools.truncate(comment.title, 50)
				};

			var subject;
			if (commenter) {
				subjectvars.COMMENTER = StringTools.truncate(commenter.username, 10);
				subject = mf('notification.comment.mail.subject', subjectvars, "Comment on {COURSE} by {COMMENTER}: {TITLE}", userLocale);
			} else {
				subject = mf('notification.comment.mail.subject.anon', subjectvars, "Anonymous comment on {COURSE}: {TITLE}", userLocale);
			}

			return (
			    { course: course
				, courseLink: Router.url('showCourse', course, { hash: 'comment'+comment._id })
				, subject: subject
				, comment: comment
				, commenter: commenter
				}
			);
		},
		template: "notificationCommentMail"
	};
}
