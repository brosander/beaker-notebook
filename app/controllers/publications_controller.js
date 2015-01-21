var RecordNotUniqueError = require("../lib/record_not_unique_error"),
    _ = require('lodash');

module.exports = function(app) {
  var Publication = app.Models.Publication,
      Notebook = app.Models.Notebook;

  function querySearchTerm(req, query) {
    if (req.query.searchTerm) {
      return query
        .where('name', 'ilike', '%'+req.query.searchTerm+'%')
        .orWhere('description', 'ilike', '%'+req.query.searchTerm+'%');
    }
  }

  return {
    index: function(req, res, next) {
      var publicationList = Publication.query(function(q) {
        q.limit(req.query.limit);
        q.offset(req.query.offset);
        q.orderBy('created_at', 'desc');
      });

      publicationList.query(function(q) {
        querySearchTerm(req, q);
      });

      if (req.query.category_id) {
        publicationList.query(function(q) {
          q.having('category_id', '=', req.query.category_id);
          q.groupBy('publications.id');
        });
      }

      publicationList
      .fetchAll({ withRelated: ['author', 'category'] })
      .then(function(publications) {
        _.each(publications.models, function(publication) {
          publication.set('languages', Publication.languages(publication.get('contents')));
        });
        res.json(publications);
      })
      .catch(next);
    },

    count: function(req, res, next) {
      var searchParams = _.pick(req.query, ['category_id']);
      var publicationCount = Publication.query()
      .count('*')
      .where(searchParams);

      querySearchTerm(req, publicationCount);

      publicationCount
      .then(function(row) {
        res.json(parseInt(_.first(row).count));
      })
      .catch(next);
    },

    get: function(req, res, next) {
      Publication.withAuthor(req.params.id)
        .then(res.json.bind(res))
        .catch(next);
    },

    create: function(req, res, next) {
      Notebook.forge({ id: req.body.notebookId, userId: req.user.id })
      .fetch({ require: true })
      .then(function(notebook) {
        return notebook.getData().then(function(data) {
          return Publication.forge({
            notebookId: req.body.notebookId,
            userId: req.user.id,
            name: notebook.get('name'),
            contents: data,
            description: req.body.description,
            categoryId: req.body.categoryId
          })
          .save();
        });
      })
      .then(function(notebook) {
        Notebook.forge({ id: req.body.notebookId })
        .fetch({ withRelated: 'publication' })
        .then(res.json.bind(res));
      })
      .catch(Notebook.NotFoundError, function() {
        return res.status(404).end();
      })
      .catch(next);
    },

    update: function(req, res, next) {
      return new Notebook({ id: req.body.notebookId, userId: req.user.id })
      .fetch({ require: true, withRelated: 'publication' })
      .then(function(notebook) {
        return notebook.getData().then(function(data) {
          var attrs = {
            name: notebook.get('name'),
            contents: data,
            description: req.body.description,
            category_id: req.body.categoryId
          };

          return new Publication({
            id: req.body.id,
            user_id: req.user.id
          })
          .save(attrs, {patch: true})
          .then(function(publication) {
            return notebook.load('publication');
          });
        });
      })
      .then(res.json.bind(res))
      .catch(Notebook.NotFoundError, function() {
        return res.status(404).end();
      })
      .catch(next);
    },

    destroy: function(req, res, next) {
      Publication
      .query({where: {'id': req.params.id}, andWhere: {'user_id': req.user.id}})
      .fetch()
      .then(function(publication) {
        return publication.destroy()
        .then(res.json.bind(res));
      })
      .catch(next);
    },

    copy: function(req, res, next) {
      req.user.projects()
      .query({where: {id: req.body.projectId}})
      .fetchOne({ require: true })
      .then(function(project) {
        return Publication.forge({ id: req.params.id })
        .fetch({ require: true })
        .then(function(publication) {
          return Notebook.forge({
            projectId: project.id,
            userId: req.user.id,
            name: req.body.name,
            data: JSON.parse(publication.get('contents'))
          })
          .save()
          .then(res.json.bind(res));
        })
      })
      .catch(app.Models.Project.NotFoundError, function() {
        return res.send(404);
      })
      .catch(function(e) {
        if (e instanceof RecordNotUniqueError) {
          return res.status(409).json({ error: 'That name is already taken by another notebook in that project' });
        }
        return next(e);
      })
    }
  }
};
