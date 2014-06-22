/*
 *  Copyright 2014 TWO SIGMA OPEN SOURCE, LLC
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
/**
 * JavaScript eval plugin
 * For creating and config evaluators that evaluate JavaScript code and update code cell results.
 */
define(function(require, exports, module) {
  'use strict';
  var PLUGIN_NAME = "JavaScript";
  var stringProps = ("charAt charCodeAt indexOf lastIndexOf substring substr slice trim trimLeft trimRight " +
      "toUpperCase toLowerCase split concat match replace search").split(" ");
  var arrayProps = ("length concat join splice push pop shift unshift slice reverse sort indexOf " +
      "lastIndexOf every some filter forEach map reduce reduceRight ").split(" ");
  var funcProps = "prototype apply call bind".split(" ");
  var javascriptKeywords = ("break case catch continue debugger default delete do else false finally for function " +
      "if in instanceof new null return switch throw true try typeof var void while with").split(" ");
  var coffeescriptKeywords = ("and break catch class continue delete do else extends false finally for " +
      "if in instanceof isnt new no not null of off on or return switch then throw true try typeof until void while with yes").split(" ");

  var getCompletions = function(token, context, keywords, options) {
    var found = [], start = token.string;

    function maybeAdd(str) {
      if (str.indexOf(start) === 0 && !arrayContains(found, str))
        found.push(str);
    }

    function gatherCompletions(obj) {
      if (typeof obj === "string")
        forEach(stringProps, maybeAdd);
      else if (obj instanceof Array)
        forEach(arrayProps, maybeAdd);
      else if (obj instanceof Function)
        forEach(funcProps, maybeAdd);
      for (var name in obj)
        maybeAdd(name);
    }

    if (context) {
      // If this is a property, see if it belongs to some object we can
      // find in the current environment.
      var obj = context.pop(), base;
      if (obj.type.indexOf("variable") === 0) {
        if (options && options.additionalContext)
          base = options.additionalContext[obj.string];
        base = base || window[obj.string];
      } else if (obj.type === "string") {
        base = "";
      } else if (obj.type === "atom") {
        base = 1;
      } else if (obj.type === "function") {
        if (window.jQuery !== null && (obj.string === '$' || obj.string === 'jQuery') &&
            (typeof window.jQuery === 'function'))
          base = window.jQuery();
        else if (window._ !== null && (obj.string === '_') && (typeof window._ === 'function'))
          base = window._();
      }
      while (base !== null && context.length)
        base = base[context.pop().string];
      if (base !== null)
        gatherCompletions(base);
    }
    else {
      // If not, just look in the window object and any local scope
      // (reading into JS mode internals to get at the local and global variables)
      for (var v = token.state.localVars; v; v = v.next)
        maybeAdd(v.name);
      for (var v = token.state.globalVars; v; v = v.next)
        maybeAdd(v.name);
      gatherCompletions(window);
      forEach(keywords, maybeAdd);
    }
    return found;
  };
  var Pos = CodeMirror.Pos;

  function forEach(arr, f) {
    for (var i = 0, e = arr.length; i < e; ++i)
      f(arr[i]);
  }

  function arrayContains(arr, item) {
    if (!Array.prototype.indexOf) {
      var i = arr.length;
      while (i--) {
        if (arr[i] === item) {
          return true;
        }
      }
      return false;
    }
    return arr.indexOf(item) !== -1;
  }

  function scriptHint(editor, keywords, getToken, options) {
    // Find the token at the cursor
    var cur = editor.getCursor(), token = getToken(editor, cur), tprop = token;
    token.state = CodeMirror.innerMode(editor.getMode(), token.state).state;

    // If it's not a 'word-style' token, ignore the token.
    if (!/^[\w$_]*$/.test(token.string)) {
      token = tprop = {start: cur.ch, end: cur.ch, string: "", state: token.state,
        type: token.string === "." ? "property" : null};
    }
    // If it is a property, find out what it is a property of.
    while (tprop.type === "property") {
      tprop = getToken(editor, Pos(cur.line, tprop.start));
      if (tprop.string !== ".")
        return;
      tprop = getToken(editor, Pos(cur.line, tprop.start));
      if (tprop.string === ')') {
        var level = 1;
        do {
          tprop = getToken(editor, Pos(cur.line, tprop.start));
          switch (tprop.string) {
            case ')':
              level++;
              break;
            case '(':
              level--;
              break;
            default:
              break;
          }
        } while (level > 0);
        tprop = getToken(editor, Pos(cur.line, tprop.start));
        if (tprop.type.indexOf("variable") === 0)
          tprop.type = "function";
        else
          return; // no clue
      }
      if (!context)
        var context = [];
      context.push(tprop);
    }
    return getCompletions(token, context, keywords, options);
  }

  var BkTable = function(td) {
    var t = {};
    _(td.columnNames).each(function(cname, i) {
      if (_.isEmpty(cname)) {
        cname = "index";
      }
      var colValues;
      if (cname === "Date") {
        colValues = _(td.values).map(function(it) { return Date.parse(it[i]); });
      } else {
        colValues = _(td.values).map(function(it) { return parseFloat(it[i].trim()); });
      }
      colValues.name = cname;
      t[cname] = colValues;
    });
    return t;
  };

  var ColorFactory = (function() {
    var colors = ['#C0504D', '#4F81BD', '#9BBB59', '#F79646', '#8064A2'];
    var i = 0;
    return {
      getColor: function() {
        return colors[i++];
      },
      reset: function() {
        i = 0;
      }
    }
  })();

  var Line = function(x, y, color) {
    return {
      legend: y.name,
      color: !_.isEmpty(color) ? color : ColorFactory.getColor(),
      type: 'line',
      interpolation: 'linear',
      width: 3,
      points: _(_.zip(x, y)).map(function (it) {
        return _.object(["x", "y"], it);
      })
    };
  };

  var Bars = function(x, y, color) {
    return {
      legend: y.name,
      color: !_.isEmpty(color) ? color : ColorFactory.getColor(),
      type: 'bar',
      interpolation: 'linear',
      width: 75000000,
      points: _(_.zip(x, y)).map(function (it) {
        return _.object(["x", "y"], it);
      })
    };
  };

  var CombinedPlot = function (gg1, gg2) {
    return {
      "type": "CombinedPlot",
      "plotTitle": "Mummy Combined Plot",
      "plots": [
        {
          "xCursor": { style: "solid", color: "#003366", width: 3},
          "yCursor": { style: "dash", color: "#003366", width: 2 },
          "xCoords": false,
          "data": gg1
        },
        {
          "xCursor": { style: "solid", color: "#003366", width: 3},
          "yCursor": { style: "dash", color: "#003366", width: 2 },
          "height": 120,
          "data": gg2
        }
      ]
    };
  };

  var JavaScript_0 = {
    pluginName: PLUGIN_NAME,
    cmMode: "javascript",
    background: "#FFE0F0",
    evaluate: function(code, modelOutput, evalId, sessionId) {
      ColorFactory.reset();

      var evaluationsRef = new Firebase(window.fb.ROOT_URL + sessionId + "/_evaluations");
      var evalRef = new Firebase(window.fb.ROOT_URL + sessionId + "/_evaluations/" + evalId);
      //var outputRef = new Firebase(window.fb.ROOT_URL + sessionId + "_evaluations/" + evalId + "/output");

      return bkHelper.fcall(function() {
        evaluationsRef.once("value", function(snapshot) {
          var evaluations = snapshot.val();
          console.log("evaluations = ", evaluations);
          var evalIds = _(evaluations).keys();
          var thisIndex = evalIds.indexOf(evalId);
          var output = {
            "begin_time": new Date().getTime(),
            "result": "evaluating",
            "evalId": evalId,
            "eid": _(evaluations).keys().indexOf(evalId)
          };
          evalRef.update({
            "output": output
          });
          bkHelper.refreshRootScope();

          var bk_out = _(_(evaluations).values()).map(function(it) {
            return _.isObject(it.output.result) ? JSON.stringify(it.output.result) : it.output.result;
          });
          var bk_ = bk_out.length > 1 ? bk_out[bk_out.length - 2] : null;
          var bk = {
            $_: bk_,
            _out: bk_out,
            updateThisOutput: function(value) {
              output.result = value;
              output.last_update_time = new Date().getTime();
              evalRef.update({"output": output}, function() {
                bkHelper.refreshRootScope();
                console.log("output", output);
              });
            }
          };

          var result;
          try {
            result = eval(code);
//            if (!_(result).isNumber()) {
//              result = result.toString();
//            }
          } catch (err) {
            result = {
              type: "BeakerDisplay",
              innertype: "Error",
              object: "" + err
            };
          }
          output.result = result;
          output.end_time = new Date().getTime();

          //evalRef.update({"output": output});
          //outputRef.update({"result": result});
          modelOutput.result = result;
        });
      });
    },
    autocomplete2: function(editor, options, cb) {
      var ret = scriptHint(editor, javascriptKeywords,
          function(e, cur) {
            return e.getTokenAt(cur);
          },
          options);
      cb(ret);
    },
    updateJsSetting1: function() {
      //console.log("dummy Setting#1", this.settings.pySetting1);
    },
    updateJsSetting2: function() {
      //console.log("dummy Setting#2", this.settings.jsSetting2);
    },
    updateAll: function() {
      this.updateJsSetting1();
      this.updateJsSetting2();
    },
    spec: {
    }
  };
  var JavaScript0 = function(settings) {
    if (!settings.jsSetting2) {
      settings.jsSetting2 = "";
    }
    if (!settings.jsSetting1) {
      settings.jsSetting1 = "";
    }
    if (!settings.view) {
      settings.view = {};
    }
    if (!settings.view.cm) {
      settings.view.cm = {};
    }
    settings.view.cm.mode = JavaScript_0.cmMode;
    settings.view.cm.background = JavaScript_0.background;
    this.settings = settings;
    this.updateAll();
    this.perform = function(what) {
      var action = this.spec[what].action;
      this[action]();
    };
  };
  JavaScript0.prototype = JavaScript_0;

  exports.getEvaluatorFactory = function() {
    return bkHelper.getEvaluatorFactory(bkHelper.newPromise(JavaScript0));
  };
  exports.name = PLUGIN_NAME;
});
