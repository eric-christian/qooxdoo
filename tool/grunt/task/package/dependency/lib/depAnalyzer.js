/* *****************************************************************************

   qooxdoo - the new era of web development

   http://qooxdoo.org

   Copyright:
     2013-2014 1&1 Internet AG, Germany, http://www.1und1.de

   License:
     LGPL: http://www.gnu.org/licenses/lgpl.html
     EPL: http://www.eclipse.org/org/documents/epl-v10.php
     See the LICENSE file in the project's top-level directory for details.

   Authors:
     * Thomas Herchenroeder (thron7)
     * Richard Sternagel (rsternagel)

***************************************************************************** */

'use strict';

/**
 * @module depAnalyzer
 *
 * @desc
 * Collects external dependencies (i.e. unknown/unresolved symbols)
 * of qooxdoo class files. This encompasses:
 * <ul>
 *  <li>starting at seed classes exploring recursivly all dependencies</li>
 *  <li>collecting dependencies divided in load- and runtime deps</li>
 *  <li>calculating the class list order (by topological sorting)</li>
 *  <li>collecting @-hints (ignore, require, use, asset, cldr)</li>
 *  <li>generating an @-hint index over all files</li>
 * </ul>
 *
 * The most important packages to accomplish this are:
 * <ul>
 *  <li>{@link https://github.com/ariya/esprima/|esprima}
 *      ({@link http://esprima.org/demo/parse.html|live demo})</li>
 *  <li>{@link https://github.com/Constellation/escope|escope}
 *      ({@link http://mazurov.github.io/escope-demo/|live demo})</li>
 *  <li>{@link https://github.com/Constellation/escodegen|escodegen}
 *      ({@link http://constellation.github.com/escodegen/demo/|live demo})</li>
 *  <li>{@link https://github.com/Constellation/doctrine|doctrine}
 *      ({@link http://constellation.github.io/doctrine/demo/|live demo})</li>
 * </ul>
 */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

// native
var fs = require('fs');
var path = require('path');

// third party
var esprima = require('esprima');
var escope = require('escope');
var escodegen = require('escodegen');
var doctrine = require('doctrine');
var Toposort = require('toposort-class');
var glob = require('glob');
var minimatch = require("minimatch");
var _ = require('underscore');

// not pretty (require internals of jshint) but works
var js_builtins = require('jshint/src/vars');

// local (modules may be injected by test env)
var parentAnnotator = (parentAnnotator || require('./annotator/parent'));
var classNameAnnotator = (classNameAnnotator || require('./annotator/className'));
var loadTimeAnnotator = (loadTimeAnnotator || require('./annotator/loadTime'));
var qxCoreEnv = (qxCoreEnv || require('./qxCoreEnv'));
var util = (util || require('./util'));

//------------------------------------------------------------------------------
// Attic
//------------------------------------------------------------------------------

// This envisaged code may be useful as starting point
// at some point - if not remove it completly someday ...

/**
 * See ecmascript/frontend/tree.py#hasParentContext
 */
/*
function hasParentContext(node, parent_expression) {
  var curr_node = node;
  parent_expression.split('/').reverse().forEach(function (path_elem) {
    if (curr_node.parent) {
      if (path_elem == '*' || curr_node.parent.type == path_elem) {
        curr_node = curr_node.parent;
      } else {
        return false;
      }
    } else {
      return false;
    }
    return true;
  }
}
*/

/**
 * Return [name, map_tree] for any class map found in etree.
 * Restricted to top-level class definitions.
 */
/*
function getClassMaps(etree, optObj) {
  var controller = new estraverse.Controller();
  controller.traverse(etree, {
    enter : function (node,parent) {
      if (is_factory_call(node) && hasParentContext(node, "Program/ExpressionStatement")){

      }
    }
  }
}
*/

/**
 * Gather the remain globals that are not referenced outside of class maps.
 *
 * Approach: Take the .through references from the global escope.Scope and
 * remove those references that point inside class maps. The remaining are
 * unresolved symbols referenced in code that is not part of a class map.
 */
/*
function get_non_class_deps(etree, deps_map, optObj) {
}
*/

/**
 * Better alternative to analyze_tree():
 * Get dependencies as a structured map that reflects qooxdoo's class map.
 * This allows for good caching (these deps are shallow), and is much better
 * for transitive load dependency exploration:
 * - the driver for the transitive dependencies just has to use this function
 *   and pick the deps of a specific feature *plus* the non-class deps.
 *
 * Sample return value:
 *
 *   {
 *     __non_class_code__ : []  // top-level, @require etc.
 *     "custom.Application" : {
 *       extend : [<escope.Reference>, ...],
 *       implement : [...],
 *       statics : {
 *         foo : [...],
 *         bar : [...]
 *       },
 *       members : {
 *         baz : [...],
 *         yep : [...]
 *       }
 *       destruct : [...],
 *       defer : [...],
 *       ...
 *     }
 *   }
 *
 * @returns {Object} map embedding dependencies { 'custom.ClassA' : { extend : [escope.References] } }
 */
/*
var KeysWithSubMaps = {
  statics:true,
  members:true,
};
*/


/**
 * Get deps by analysing this paricular (sub)tree.
 */
 /*
function analyze_tree(etree, optObj) {
}
*/

/*
function analyze_as_map(etree, optObj) {
  var result = {};

  // extract deps from class maps
  getClassMaps(etree, optObj).forEach(function (class_spec) { // class_spec = ["custom.ClassA" : <esprima.Node>]
    var class_name = class_spec[0];
    var class_map = class_spec[1];
    var deps_map = result[class_name] = {};
    var curr_map;

    // iterate class map
    class_spec.properties.forEach(function (prop) {
      var prop_name = prop.key.name;
      // iterate sub-maps
      if (prop_name in KeysWithSubMaps) {
        curr_map = deps_map[prop_name] = {};
        prop.value.properties.forEach(function (subprop) {
          var sprop_name = subprop.key.name;
          curr_map[sprop_name] = analyze_tree(subprop.value, optObj);
        });
      } else {
        deps_map[prop_name] = analyze_tree(prop.value, optObj);
      }
    });
  });

  // take the remaining symbols for the remaining code in the tree
  // this includes all code outside class maps, top-level code, @require hints, etc.
  result['__non_class_code__'] = get_non_class_deps(etree, deps_map, optObj);

  return result;
}
*/

//------------------------------------------------------------------------------
// Privates
//------------------------------------------------------------------------------

// privates may be injected by test env

/**
 * Whether node is a variable node.
 *
 * @param {string} node - an esprima node
 * @returns {boolean}
 */
function isVar(node) {
  return ["Identifier", "MemberExpression"].indexOf(node.type) !== -1;
}

/**
 * Finds the root of a var node.
 *
 * @param {Object} varNode - an esprima node
 * @returns {(Object|undefined)}
 */
function findVarRoot(varNode) {
  if (!isVar(varNode)) {
    return undefined;
  } else {
    while (varNode.parent &&
      varNode.parent.type === 'MemberExpression' &&
      varNode.parent.computed === false) {
      varNode = varNode.parent;
    }
    return varNode;
  }
}

/**
 * Takes a variable node and returns the longest
 * possible variable name (with or without method name)
 * i.e. a full-quallified class name.
 *
 * <p>example input</p>
 * <ul>
 *  <li><code>qx.ui.treevirtual.MTreePrimitive.Type.BRANCH</code></li>
 *  <li><code>qx.ui.table.Table</code></li>
 *  <li><code>qx.ui.basic.Label.toggleRich()</code></li>
 *  <li><code>qx.event.IEventHandler</code></li>
 *  <li><code>WebKitCSSMatrix</code></li>
 *  <li><code>qxWeb</code></li>
 *  <li><code>qx</code></li>
 * </ul>
 *
 * <p>example output should be (withoutMethodName)</p>
 * <ul>
 *  <li><code>qx.ui.treevirtual.MTreePrimitive</code></li>
 *  <li><code>qx.ui.table.Table</code></li>
 *  <li><code>qx.ui.basic.Label</code></li>
 *  <li><code>qx.event.IEventHandler</code></li>
 *  <li><code>WebKitCSSMatrix</code></li>
 *  <li><code>qxWeb</code></li>
 *  <li><code>qx</code></li>
 * </ul>
 *
 * @param {string} varNode
 * @param {boolean} [withoutMethodName]
 * @returns {string}
 */
function assemble(varNode, withMethodName) {
  var varRoot = findVarRoot(varNode);
  var assembled = escodegen.generate(varRoot);
  withMethodName = withMethodName || false;

  if (!withMethodName) {
    // cut off method name (e.g. starting with [_$a-z]+)
    // or constants (e.g. Bootstrap.DEBUG)
    var cutOff = function(assembled) {
      var posOfLastDot = assembled.lastIndexOf('.');

      if (posOfLastDot === -1) {
        // e.g. qx or WebKitCssMatrix
        return assembled;
      }

      var firstCharLastWord = assembled[posOfLastDot+1];
      var lastSnippet = assembled.substr(posOfLastDot+1);
      var isUpperCase = function(charOrWord) {
        return charOrWord === charOrWord.toUpperCase();
      };
      var needsCut = function() {
        // match e.g.:
        //  - qx.MyClassName.myMethodName
        //  - Bootstrap.DEBUG
        //  - qx.util.fsm.FiniteStateMachine.StateChange.CURRENT_STATE
        return (firstCharLastWord === firstCharLastWord.toLowerCase() ||
                lastSnippet.split("").every(isUpperCase) ||
                /(\.[A-Z].+){2,}/.test(assembled));
      };

      if (needsCut()) {
        assembled = assembled.substr(0, posOfLastDot);
        // recurse because of sth. like 'qx.bom.Style.__supports.call'
        return cutOff(assembled);
      }

      return assembled;
    };

    assembled = cutOff(assembled);
  }

  return assembled;
}

/**
 * Collects all non-resolved (i.e. unknown to this scope)
 * dependencies of the given scope.
 *
 * @param {Scope} scope - a scope object
 * @returns {Reference[]}
 * @see {@link http://constellation.github.io/escope/Scope.html|Scope class}
 * @see {@link http://constellation.github.io/escope/Reference.html|Reference class}
 * @see {@link http://esprima.org/doc/#ast|esprima AST}
 */
function dependenciesFromAst(scope) {
  var dependencies = [];

  scope.through.forEach( function (ref) {
    if (!ref.resolved) {
      dependencies.push(ref);
    }
  });

  return dependencies;
}

/**
 * Identifies builtins and reserved words. Uses
 * Code (global/builtin names) from JSHint.
 *
 * @param {Reference} ref - a scope reference
 * @returns {boolean}
 * @see {@link http://constellation.github.io/escope/Reference.html|Reference class}
 * @see {@link https://github.com/jshint/jshint/blob/master/src/vars.js|JSHint globals}
 */
function notBuiltin(ref) {
  var ident = ref.identifier;
  if (ident.type !== "Identifier") {
    return true;
  }

  var isBuiltin = function(el) {
    return ident.name in js_builtins[el];
  };

  var missingOrCustom = ["undefined", "Infinity", "performance"];

  // check in various js_builtins maps
  if (['reservedVars',
       'ecmaIdentifiers',
       'browser',
       'devel',
       'worker',
       'wsh',
       'nonstandard'].some(isBuiltin) || missingOrCustom.indexOf(ident.name) !== -1) {
      return false;
  }
  return true;
}

/**
 *  Identifies <code>qx.$$foo</code>, <code>qx.foo.$$bar</code> and
 *  <code>qx.foo.Bar.$$method</code> dependencies (e.g. <code>qx.$$libraries</code>,
 *  <code>qx.$$resources</code> ...).
 *
 * @param {Reference} ref - a scope reference
 * @returns {boolean}
 * @see {@link http://constellation.github.io/escope/Reference.html|Reference class}
 */
function notQxInternal(ref) {
  var propertyPath;
  var ident = ref.identifier;

  if (ident.type !== "Identifier") {
    return true;
  }

  var startsWithTwoDollars = function(propertyPath, propName) {
    return (propertyPath[propName]
            && propertyPath[propName][0] === "$"
            && propertyPath[propName][1] === "$");
  };

  // e.g. qx.$$libraries
  if (propertyPath = util.get(ident, "parent.property")) {
    if (startsWithTwoDollars(propertyPath, "name")) {
      return false;
    }
  }


  // e.g. qx.Bootstrap.$$logs
  if (propertyPath = util.get(ident, "parent.property.parent.parent.property")) {
    if (startsWithTwoDollars(propertyPath, "name")) {
      return false;
    }
  }

  // e.g. qx.core.Property.$$method
  if (propertyPath = util.get(ident, "parent.property.parent.parent.property.parent.parent.property")) {
    if (startsWithTwoDollars(propertyPath, "name")) {
      return false;
    }
  }

  return true;
}

/**
 * Whether scope reference (from escope) is a load time dependency.
 *
 * @param {Reference} ref - a scope reference
 * @returns {boolean}
 * @see {@link http://constellation.github.io/escope/Reference.html|Reference class}
 */
function notRuntime(ref) {
  return !!(ref && ref.from && ref.from.isLoadTime);
}

/**
 * Unifies and sanitizes (only strings, uniq, sort and no self reference) dependencies.
 *
 * @param {string[]} deps
 * @param {string} className
 * @returns {string[]} deps - sanitized and filtered deps
 */
function unify(deps, className) {
  // flatten (ref2string)
  var shallowDeps = deps.map(function (dep) {
    if (_.isString(dep)) {
      return dep;
    } else {
      return assemble(dep.identifier);
    }
  });

  // no empty deps (e.g. "qx" global which will exist)
  shallowDeps = _.without(shallowDeps, "qx");

  // sort & uniq
  shallowDeps = _.sortBy(_.uniq(shallowDeps), function(char) {
    return char;
  });

  // no exact self refs XOR deps starting with className and therefore
  // very likely from class within (e.g. constant refs)
  return _.filter(shallowDeps, function(dep) {
    return (dep !== className && dep.indexOf(className+".") === -1);
  });
}

/**
 * Extracts classes from tag description
 * (e.g. '(<code>qx.foo.Bar</code>, <code>qx.baz.*</code>)') as array.
 *
 * @param {string} tag - tag description
 * @returns {string[]} - extracted classes
 */
function getClassesFromTagDesc(tag) {
  var classes = [8];
  var match = /\(([^, ]+(, ?)?)+\)/.exec(tag);
  if (match !== null) {
    classes = match[0].slice(1, -1).split(",").map(function (clazz) {
      return clazz.trim();
    });
  }
  return classes;
}

/**
 * Extracts resource from tag description (e.g. '(myApp/*)').
 *
 * @param {string} tag - tag description
 * @returns {string} - extracted resource
 */
function getResourcesFromTagDesc(tag) {
  var resource = "";
  if (/\([^)]+\)/.test(tag)) {
    resource = tag.slice(1, -1);
  }
  return resource;
}

/**
 * <p>Walks through @-hints and applies them.</p>
 *
 * <ul>
 *  <li>@ignore => remove dep within load and run deps</li>
 *  <li>@require => add dep to load deps</li>
 *  <li>@use => add dep to load deps </li>
 * </ul>
 *
 * @param {string[]} deps
 * @param {string} className
 * @returns {string[]} deps
 */
function applyIgnoreRequireAndUse(deps, className) {
  var toBeFiltered = [];
  var atHints = deps.athint;
  var collectIgnoredDeps = function(dep) {
    atHints.ignore.forEach(function(ignore) {
      if (toBeFiltered.indexOf(ignore) === -1) {
        // TODO: is it better to use minimatch here?
        // what does the manual state about @ignore?
        var ignoreRegex = new RegExp("^"+ignore+"$");
        if (ignoreRegex.test(dep)) {
          toBeFiltered.push(dep);
        }
      }
    });
  };
  var shouldBeIgnored = function(dep) {
    return (toBeFiltered.indexOf(dep) === -1);
  };

  // @ignore
  if (atHints.ignore.length > 0) {
    for (var key in {load: true, run: true}) {
      toBeFiltered = [];
      deps[key].forEach(collectIgnoredDeps);
      deps[key] = deps[key].filter(shouldBeIgnored);
    }
  }

  var classesOnly = [];
  var ignoreHashMethodAugmentation = function(hints, className) {
    var classesOnly = [];
    hints.forEach(function(dep) {
      var posHash = 0;
      var hintClass = "";
      // TODO: ignore qx.foo.Bar#getMyWhatever for now
      // just require/use whole class if no self reference
      //
      // Has to be revisited for statics optimization,
      // classes which use this:
      //   * qx.bom.storage.Web
      //   * qx.bom.storage.Memory
      //   * qx.bom.storage.UserData
      //   * qx.bom.request.Script
      //   * qx.bom.request.Xhr
      //   * qx.util.ResponseParser
      //   * ...
      if ((posHash = dep.indexOf("#")) !== -1) {
        hintClass = dep.substr(0, posHash);
        if (hintClass === className) {
          return;
        }
        classesOnly.push(hintClass);
      } else {
        classesOnly.push(dep);
      }
    });

    return classesOnly;
  };

  // @use
  if (atHints.use.length > 0) {
    classesOnly = [];
    classesOnly = ignoreHashMethodAugmentation(atHints.use, className);
    deps.run = deps.run.concat(classesOnly);
  }

  // @require
  if (atHints.require.length > 0) {
    classesOnly = [];
    classesOnly = ignoreHashMethodAugmentation(atHints.require, className);
    deps.load = deps.load.concat(classesOnly);
  }

  return deps;
}

/**
 * Collects @-hints from esprima comment nodes.
 *
 * @param {Object} tree - esprima AST
 * @returns {Object} atHints
 * @returns {string[]} atHints.ignore
 * @returns {string[]} atHints.require
 * @returns {string[]} atHints.use
 * @returns {string[]} atHints.asset
 * @returns {boolean} atHints.cldr
 * @see {@link http://esprima.org/doc/#ast|esprima AST}
 */
function collectAtHintsFromComments(tree) {
  var topLevelCodeUnitLines = [];
  var atHints = {
    'ignore': [],
    'require': [],
    'use': [],
    'asset': [],
    'cldr': false
  };

  var isFileOrClassScopeComment = function(comment, topLevelCodeUnitLines) {
    return (comment.type === 'Block'
            && (topLevelCodeUnitLines.indexOf(comment.loc.end.line+1) !== -1  // class scope
                || comment.loc.end.line < topLevelCodeUnitLines[0]));         // file scope
  };

  // collect only file and class scope which means only top level
  // @ignore/@require/@use/@asset/@cldr are consider here for now.
  // This may be important later cause @ignore can be used within methods
  // (which is neglected here) also!
  tree.body.forEach(function (codeUnit) {
    topLevelCodeUnitLines.push(codeUnit.loc.start.line);
  });

  tree.comments.forEach(function (comment) {
    if (isFileOrClassScopeComment(comment, topLevelCodeUnitLines)) {
      var jsdoc = doctrine.parse(comment.value, { unwrap: true });
      jsdoc.tags.forEach(function (tag) {
        switch(tag.title) {
          case 'ignore':
            atHints.ignore = atHints.ignore.concat(getClassesFromTagDesc(tag.description));
            break;
          case 'require':
            atHints.require = atHints.require.concat(getClassesFromTagDesc(tag.description));
            break;
          case 'use':
            atHints.use = atHints.use.concat(getClassesFromTagDesc(tag.description));
            break;
          case 'asset':
            atHints.asset = atHints.asset.concat(getResourcesFromTagDesc(tag.description));
            break;
          case 'cldr':
            atHints.cldr = true;
            break;
          default:
        }
      });
    }
  });

  return atHints;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = {
  /**
   * Analyzes an esprima tree for unresolved references (i.e. dependencies).
   *
   * @param tree {Object} AST from esprima
   * @param {Object} [opts]
   * @param {boolean} [opts.flattened=false] - whether to divide deps into load and run
   * @returns {string[]}
   * @see {@link http://esprima.org/doc/#ast|esprima AST}
   */
  findUnresolvedDeps: function(tree, opts) {
    var deps = {
      'load' : [],
      'run' : [],
      'athint': {}
    };
    var atHints = {};
    var filteredScopeRefs = [];
    var envCallDeps = {
      'load': [],
      'run': []
    };

    // ignore eval scopes for now because they are subject to different
    // scoping rules. When really in need for eval you should know what
    // you're doing, anyway!
    var globalScope = escope.analyze(tree, {ignoreEval:true}).scopes[0];

    parentAnnotator.annotate(tree);
    loadTimeAnnotator.annotate(globalScope, true);

    // deps from Scope
    var scopesRef = dependenciesFromAst(globalScope);

    // top level atHints from tree
    atHints = collectAtHintsFromComments(tree);
    deps.athint = atHints;

    filteredScopeRefs = util.pipeline(scopesRef,
      _.partial(util.filter, notBuiltin),     // e.g. document, window, undefined ...
      _.partial(util.filter, notQxInternal)   // e.g. qx.$$libraries, qx$$resources ...
      // check library classes
    );

    deps.load = filteredScopeRefs.filter(notRuntime);
    deps.run = _.difference(filteredScopeRefs, deps.load);

    // add feature classes from qx.core.Environment calls
    envCallDeps = qxCoreEnv.extract(tree, filteredScopeRefs);
    deps.load = deps.load.concat(envCallDeps.load);
    deps.run = deps.run.concat(envCallDeps.run);

    // unify
    deps.load = unify(deps.load, tree.qxClassName);
    deps.run = unify(deps.run, tree.qxClassName);

    // add/remove deps according to atHints
    deps = applyIgnoreRequireAndUse(deps, tree.qxClassName);

    // overlappings aren't important - remove them
    // i.e. if it's already in load remove from run
    deps.run = _.difference(deps.run, deps.load);

    return (opts && opts.flattened ? deps.load.concat(deps.run) : deps);
  },

  /**
   * Collects dependencies recursively. Supports globbing of class ids.
   *
   * @param {Object} basePaths - namespace (key) and filePath (value) to library
   * @param {string[]} initClassIds - seed class ids
   * @param {string[]} excludedClassIds - class ids to be excluded
   * @returns {Object} classesDeps
   */
  collectDepsRecursive: function(basePaths, initClassIds, excludedClassIds) {
    var classesDeps = {};

    var getClassNamesFromPaths = function(filePaths) {
      return filePaths.map(function(path) {
        return util.classNameFrom(path);
      });
    };

    var globClassIds = function(classIds, basePaths) {
      var i = 0;
      var posOfStar = 0;
      var l = classIds.length;
      var cls = "";
      var clsPath = "";
      var clsPaths = [];
      var namespace = "";
      var globbedClassIds = [];

      var isNonInitFile = function(filePath) {
        return (filePath.indexOf("__init__") === -1);
      };

      // glob classIds if needed
      for (; i<l; i++) {
        cls = classIds[i];
        posOfStar = cls.indexOf("*");
        // Note: only works if "*" is last char
        if (posOfStar !== -1 && posOfStar+1 === cls.length) {
          namespace = util.namespaceFrom(cls, Object.keys(basePaths));
          clsPath = util.filePathFrom(cls+"*/*");
          clsPaths = glob.sync(clsPath, {cwd: basePaths[namespace]});
          clsPaths = clsPaths.filter(isNonInitFile);
          clsPaths = clsPaths.map(util.classNameFrom);
          globbedClassIds = globbedClassIds.concat(clsPaths);
        } else {
          globbedClassIds.push(cls);
        }
      }

      return _.uniq(globbedClassIds);
    };

    var recurse = function(basePaths, classIds, seenOrSkippedClasses, excludedClassIds) {

      var isMatching = function(strToTest, expressions) {
        var i = 0;
        var l = expressions.length;

        for (; i<l; i++) {
          if (minimatch(strToTest, expressions[i])) {
            return true;
          }
        }

        return false;
      };

      var i = 0;
      var l = classIds.length;
      for (; i<l; i++) {
        // skip excluded classes
        if (isMatching(classIds[i], excludedClassIds)) {
          continue;
        }

        var shortFilePath = util.filePathFrom(classIds[i]);
        var namespace = util.namespaceFrom(classIds[i], Object.keys(basePaths));
        if (!namespace) {
          throw new Error("ENOENT - Missing library. No matching namespace found for " + classIds[i]);
        }
        // console.log(namespace, shortFilePath);
        var curFullPath = path.join(basePaths[namespace], shortFilePath);
        if (!fs.existsSync(curFullPath)) {
          throw new Error("ENOENT - "+curFullPath+" doesn't exist.");
        }
        var jsCode = fs.readFileSync(curFullPath, {encoding: 'utf8'});
        var tree = esprima.parse(jsCode, {comment: true, loc: true});
        var classDeps = {
          'load': [],
          'run': []
        };

        classNameAnnotator.annotate(tree, util.classNameFrom(shortFilePath));
        classDeps = findUnresolvedDeps(tree, {flattened: false});
        var className = util.classNameFrom(shortFilePath);

        // Note: Excluded classes will still be entries in load and run deps!
        // Maybe it's better to remove them here too ...
        classesDeps[className] = classDeps;
        // console.log(className);

        var loadAndRun = classDeps.load.concat(classDeps.run);
        for (var j=0; j<loadAndRun.length; j++) {
          var dep = loadAndRun[j];
          // console.log("  ", dep);

          // only recurse non-skipped and non-excluded classes
          if (!isMatching(dep, seenOrSkippedClasses.concat(excludedClassIds))) {
            seenOrSkippedClasses.push(dep);
            recurse(basePaths, [dep], seenOrSkippedClasses, excludedClassIds);
          }
        }
      }
      return classesDeps;
    };

    // start with globbed initClassIds
    initClassIds = globClassIds(initClassIds, basePaths);
    return recurse(basePaths, initClassIds, initClassIds, excludedClassIds);
  },

  /**
   * Sorts classes topologically (after their dependencies) to ensure a
   * proper class list sorted by a specific order ('load' most of the time).
   *
   * @param {} classesDeps
   * @param {string} subkey - 'load' or 'run'
   * @param {string[]} excludedClassIds
   * @returns {string[]} classListSorted
   */
  sortDepsTopologically: function(classesDeps, subkey, excludedClassIds) {
    var tsort = new Toposort();
    var classListSorted = [];
    var i = 0;
    var j = 0;
    var k = 0;
    var l = excludedClassIds.length;
    var l2 = 0;
    var l3 = 0;
    var toBeRemoved = [];

    for (var clazz in classesDeps) {
      tsort.add(clazz, classesDeps[clazz][subkey]);
    }
    classListSorted = tsort.sort().reverse();

    // take care of excludes
    l2 = classListSorted.length;
    for (; i<l; i++) {
      j = 0;
      for (; j<l2; j++) {
        if (minimatch(classListSorted[j], excludedClassIds[i])) {
          toBeRemoved.push(classListSorted[j]);
        }
      }
    }
    l3 = toBeRemoved.length;
    for (; k<l3; k++) {
      classListSorted = _.without(classListSorted, toBeRemoved[k]);
    }

    return classListSorted;
  },

  /**
   * Prepends the matching namespace to the class (<code>qx.foo.Bar</code> => <code>qx:qx.foo.Bar</code>).
   *
   * @param {string[]} classList
   * @param {string[]} namespaces
   * @return {string[]} classList
   */
  prependNamespace: function(classList, namespaces) {
    var augmentClassWithNamespace = function(className) {
      var exceptions = ["qxWeb.js", "q.js"];

      if (exceptions.indexOf(className) !== -1) {
        return "qx:"+className;
      }

      var prefix = util.namespaceFrom(className, namespaces);
      return prefix+":"+className;
    };

    return classList.map(augmentClassWithNamespace);
  },

  /**
   * Translates class ids to paths (<code>qx.foo.Bar</code> => <code>qx/foo/Bar.js</code>).
   *
   * @param {string[]} classList
   * @return {string[]} classList
   */
  translateClassIdsToPaths: function(classList) {
    var translateToPath = function(classId) {
      // if namespace is already prepended only pathify classId
      var splitted = classId.split(":");
      return (splitted.length === 2)
             ? splitted[0] +":"+ splitted[1].replace(/\./g, "/") + ".js"
             : classId.replace(/\./g, "/") + ".js";
    };

    return classList.map(translateToPath);
  },

  /**
   * Creates an @-hint index (by class name) of all given deps.
   *
   * @param {Object} deps
   * @param {Object} [options]
   * @param {boolean} [options.ignore=true] - whether to include ignore hints
   * @param {boolean} [options.require=true] - whether to include require hints
   * @param {boolean} [options.use=true] - whether to include use hints
   * @param {boolean} [options.asset=true] - whether to include asset hints
   * @param {boolean} [options.cldr=true] - whether to include cldr hints
   * @returns {Object} index
   */
  createAtHintsIndex: function(deps, options) {
    var idx = {
      ignore: {},
      require: {},
      use: {},
      asset: {},
      cldr: []
    };
    var opts = {};
    var clazz = "";
    var key = "";

    if (!options) {
      options = {};
    }

    // merge options and default values
    opts = {
      ignore: options.ignore === false ? false : true,
      require: options.require === false ? false : true,
      use: options.use === false ? false : true,
      asset: options.asset === false ? false : true,
      cldr: options.cldr === false ? false : true
    };

    // collect hints
    for (clazz in deps) {
      if (deps[clazz].athint.ignore.length > 0) {
        idx.ignore[clazz] = deps[clazz].athint.ignore;
      }
      if (deps[clazz].athint.require.length > 0) {
        idx.require[clazz] = deps[clazz].athint.require;
      }
      if (deps[clazz].athint.use.length > 0) {
        idx.use[clazz] = deps[clazz].athint.use;
      }
      if (deps[clazz].athint.asset.length > 0) {
        idx.asset[clazz] = deps[clazz].athint.asset;
      }
      if (deps[clazz].athint.cldr) {
        idx.cldr.push(clazz);
      }
    }

    // remove unwanted
    for (key in idx) {
      if (opts[key] === false && idx[key]) {
        delete idx[key];
      }
    }

    return idx;
  }
};

// shortcuts
var findUnresolvedDeps = module.exports.findUnresolvedDeps;
var collectDepsRecursive = module.exports.collectDepsRecursive;
var createAtHintsIndex = module.exports.createAtHintsIndex;
var sortDepsTopologically = module.exports.sortDepsTopologically;
var prependNamespace = module.exports.prependNamespace;
var translateClassIdsToPaths = module.exports.translateClassIdsToPaths;
