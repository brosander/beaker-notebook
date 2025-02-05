/*
 *  Copyright 2015 TWO SIGMA OPEN SOURCE, LLC
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

(function() {
  'use strict';

  // Override markdown link renderer to always have `target="_blank"`
  // Mostly from Renderer.prototype.link
  // https://github.com/chjj/marked/blob/master/lib/marked.js#L862-L881
  var bkRenderer = new marked.Renderer();
  bkRenderer.link = function(href, title, text) {
    var prot;
    if (this.options.sanitize) {
      try {
        prot = decodeURIComponent(unescape(href))
        .replace(/[^\w:]/g, '')
        .toLowerCase();
      } catch (e) {
        return '';
      }
      //jshint ignore:start
      if (prot.indexOf('javascript:') === 0 || prot.indexOf('vbscript:') === 0) {
        //jshint ignore:end
        return '';
      }
    }
    var out = '<a href="' + href + '"';
    if (title) {
      out += ' title="' + title + '"';
    }
    out += ' target="_blank"'; // < ADDED THIS LINE ONLY
    out += '>' + text + '</a>';
    return out;
  };

  bkRenderer.paragraph = function(text) {
    // Allow users to write \$ to escape $
    return marked.Renderer.prototype.paragraph.call(this, text.replace(/\\\$/g, '$'));
  };

  var module = angular.module('bk.notebook');
  module.directive('bkMarkdownEditable', ['bkSessionManager', 'bkHelper', 'bkCoreManager', '$timeout', function(bkSessionManager, bkHelper, bkCoreManager, $timeout) {
    var notebookCellOp = bkSessionManager.getNotebookCellOp();
    var getBkNotebookWidget = function() {
      return bkCoreManager.getBkApp().getBkNotebookWidget();
    };
    return {
      restrict: 'E',
      template: JST["mainapp/components/notebook/markdown-editable"](),
      scope: {
        cellmodel: '='
      },
      link: function(scope, element, attrs) {
        var contentAttribute = scope.cellmodel.type === "section" ? 'title' : 'body';


        var evaluateJS = function (str, callback) {

          var results = [], re = /{{([^}]+)}}/g, text;

          while (text = re.exec(str)) {
            if (results.indexOf(text) === -1)
              results.push(text);
          }

          var evaluateCode = function (index) {

            if (index === results.length) {
               callback(str);
            } else {
              bkHelper.evaluateCode("JavaScript", results[index][1]).then(
                function (r) {
                  str = str.replace(results[index][0], r);
                },
                function (r) {
                  str = str.replace(results[index][0], "<font color='red'>"+"Error: **" + r.object[0] + "**" + "</font>");
                }
              ).finally(function () {
                  evaluateCode(index + 1);
                }
              );
            }
          };

          evaluateCode(0);
        };

        var doktex = function(markdownFragment) {
          try {
            renderMathInElement(markdownFragment[0], {
              delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right:  "$", display: false},
                {left: "\\[", right: "\\]", display: true},
                {left: "\\(", right: "\\)", display: false}
              ]
            });
          } catch(err) {
            bkHelper.show1ButtonModal(err.message+'<br>See: <a target="_blank" href="http://khan.github.io/KaTeX/">KaTeX website</a> and its <a target="_blank" href="https://github.com/Khan/KaTeX/wiki/Function-Support-in-KaTeX">list of supported functions</a>.', "KaTex error");
          }
        };

        var preview = function () {

          evaluateJS(
            scope.cellmodel[contentAttribute],
            function (content) {
              var markdownFragment = $('<div>' + content + '</div>');
              doktex(markdownFragment);
              var escapedHtmlContent = markdownFragment.html();
              var unescapedGtCharacter = escapedHtmlContent.replace(/&gt;/g, '>');
              element.find('.markup').html(marked(unescapedGtCharacter, {
                gfm: true,
                renderer: bkRenderer
              }));
              markdownFragment.remove();
              scope.mode = 'preview';
            });
        };

        var syncContentAndPreview = function() {
          scope.cellmodel[contentAttribute] = scope.cm.getValue();
          preview();
        };
        scope.evaluate = syncContentAndPreview;

        scope.bkNotebook = getBkNotebookWidget();

        scope.focus = function() {
          scope.edit();
          scope.$apply();
        };

        scope.edit = function(event) {
          var selection = window.getSelection() || {};
          // If the user is selecting some text, do not enter the edit markdown mode
          if (selection.type == "Range" && $.contains(element[0], selection.focusNode)) {
            return;
          }
          if (bkHelper.isNotebookLocked()) return;
          if (event && event.target.tagName === "A") return; // Don't edit if clicking a link

          scope.mode = 'edit';

          $timeout(function() {
            // remove content of markup when toggling to edit mode to prevent
            // flash when toggling back to preview mode.
            element.find('.markup').html('');

            var cm = scope.cm;
            cm.setValue(scope.cellmodel[contentAttribute]);
            cm.clearHistory();

            if (event) {
              var clickLocation;
              var wrapper = $(event.delegateTarget);
              var top = wrapper.offset().top;
              var bottom = top + wrapper.outerHeight();
              if (event !== undefined && event.pageY < (top + bottom) / 2) {
                cm.setCursor(0, 0);
              } else {
                cm.setCursor(cm.lineCount() - 1, cm.getLine(cm.lastLine()).length);
              }
            }

            if (scope.creatingNewSection === true && scope.cellmodel.type === 'section') {
              scope.creatingNewSection = false;
              var selectionStart = {line: 0, ch: 0};
              var selectionEnd = {line: 0, ch: cm.getValue().length};
              cm.setSelection(selectionStart, selectionEnd);
            }

            cm.focus();
          });
        };

        var codeMirrorOptions = _.extend(bkCoreManager.codeMirrorOptions(scope, notebookCellOp), {
          lineNumbers: false,
          mode: "markdown",
          smartIndent: false
        });

        scope.cm = CodeMirror.fromTextArea(element.find("textarea")[0], codeMirrorOptions);

        scope.bkNotebook.registerFocusable(scope.cellmodel.id, scope);
        scope.bkNotebook.registerCM(scope.cellmodel.id, scope.cm);

        scope.cm.setValue(scope.cellmodel[contentAttribute]);
        preview();

        scope.cm.on("blur", function(cm){
          setTimeout(function() {
            if(!cm.state.focused){
              scope.$apply(function() {
                syncContentAndPreview();
              });
            }
          }, 0);
        });

        scope.$on('beaker.cell.added', function(e, cellmodel) {
          if (cellmodel === scope.cellmodel) {
            scope.creatingNewSection = true;
            scope.edit();
          }
        });

        scope.$watch('cellmodel.body', function(newVal, oldVal) {
          if (newVal !== oldVal) {
            bkSessionManager.setNotebookModelEdited(true);
          }
        });

        scope.$on('$destroy', function() {
          scope.bkNotebook.unregisterFocusable(scope.cellmodel.id, scope);
          scope.bkNotebook.unregisterCM(scope.cellmodel.id, scope.cm);
          scope.cm.off();
        });
      }
    };
  }]);
})();
