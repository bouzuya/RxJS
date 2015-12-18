/// <reference path="../typings/es6-shim/es6-shim.d.ts"/>
/// <reference path="../typings/node/node.d.ts"/>
/**
 * This file generates the side-effect version of each operator,
 * and saves it in src/add by the same path+filename as
 * the original.
 *
 * The side effect version of an operator imports the operator and
 * Observable, and attaches the operator to Observable.prototype
 * (or Observable if static).
 */

var fs = require('fs');
var mkdirp = require('mkdirp');

interface OperatorWrapper {
  path?: string;
  methodType: MethodType;
  isExtended?: boolean;
  isStatic?: boolean;
  exportedFnName?: string;
  exportedClassName?: string;
  memberName?: string;
  aliases?: string[];
  newFileContents?: string;
  srcFileContents?: string;
  kitchenSinkFileContents?: string;
}

enum MethodType { Observable, Operator }

const MethodTypeDirectories = {
  [MethodType.Observable]: 'observable',
  [MethodType.Operator]: 'operator'
};

/**
 * Special operators whose name on the object or prototype is different
 * from exported function name.
 **/
const SpecialCasePrototypes = {
  'zip.ts': 'zip',
  'switch.ts': 'switch',
  'do.ts': 'do',
  'finally.ts': 'finally',
  'catch.ts': 'catch',
  'let.ts': 'let'
};

const AdditionalAliases = {
  'mergeMap.ts': ['flatMap'],
  'fromArray.ts': ['of'],
  'let.ts': ['letBind']
};

const AliasMethodOverrides = {
  'fromArray.ts': {
    of: 'of'
  }
};

function generateNewOperatorFileContents (op:OperatorWrapper): OperatorWrapper {
  var baseObject = op.isExtended ? 'observableProto' : 'Observable';
  var optPrototype = op.isStatic || op.isExtended ? '' : 'prototype.';
  var imports = `import {Observable} from '../../Observable';
import {${op.exportedFnName}} from '../../operator/${op.path.replace('.ts','')}';
${op.isExtended ? 'import {KitchenSinkOperators} from \'../../Rx.KitchenSink\';' : ''}`;
  var extendedProto = 'const observableProto = (<KitchenSinkOperators<any>>Observable.prototype);'
  var patch = op.aliases.map((alias) => {
    return `${baseObject}.${optPrototype}${alias} = ${op.exportedFnName};`;
  }).join('\n');

  var contents = `${imports}${op.isExtended ? '\n' +extendedProto + '\n' : ''}${patch}
`;

  return Object.assign({}, op, {
    newFileContents: contents
  });
}

function generateNewObservableFileContents (op:OperatorWrapper): OperatorWrapper {
  var overrides = AliasMethodOverrides[op.path];
  var imports = `import {Observable} from '../../Observable';
import {${op.exportedClassName}} from '../../observable/${op.path.replace('.ts','')}';`;
  var patch = op.aliases.map((alias) => {
    return `Observable.${alias} = ${op.exportedClassName}.${(overrides && overrides[alias]) || 'create'};`;
  }).join('\n');

  var contents = `${imports}
${patch}
`;

  return Object.assign({}, op, {
    newFileContents: contents
  });
}

function checkStatic (op:OperatorWrapper):OperatorWrapper {
  return Object.assign({}, op, {isStatic: /\-static\.ts/.test(op.path)});
}

function checkExtended (op:OperatorWrapper): OperatorWrapper {
  const extended = op.kitchenSinkFileContents.indexOf(op.memberName + '?') > -1;
  return Object.assign({}, op, {isExtended: extended})
}

function getOperatorName (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    exportedFnName: /export function ([A-Z_]*)/i.exec(op.srcFileContents)[1]
  });
}

function getClassName (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    exportedClassName: /export class ([A-Z]*)/i.exec(op.srcFileContents)[1]
  });
}

function loadSrcFile (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    srcFileContents: fs.readFileSync(`./src/${MethodTypeDirectories[op.methodType]}/${op.path}`).toString()
  })
}

function writeToDisk (op:OperatorWrapper): void {
  fs.writeFileSync(`./src/add/${MethodTypeDirectories[op.methodType]}/${op.path}`, op.newFileContents);
}

function getNameOnOperatorProto (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    memberName: SpecialCasePrototypes[op.path] || op.exportedFnName
  });
}

function getNameOnObservableProto (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    memberName: op.path.replace('.ts', '')
  });
}

function getAliases (op:OperatorWrapper): OperatorWrapper {
  return Object.assign({}, op, {
    aliases: [op.memberName, ...AdditionalAliases[op.path]].filter(v => !!v)
  });
}

function checkForCreate (op: OperatorWrapper): boolean {
  return /static create/.test(op.srcFileContents);
}

if (process.argv.find((v) => v === '--exec')) {
  mkdirp('./src/add/operator', () => {
    const kitchenSinkContents = fs.readFileSync('./src/Rx.KitchenSink.ts');
    fs.readdirSync('./src/operator')
      .filter(o => o.endsWith('.ts'))
      // Create base Operator object
      .map(o => {
        return {
          path: o,
          methodType: MethodType.Operator,
          kitchenSinkFileContents: kitchenSinkContents
        };
      })
      .map(loadSrcFile)
      // Only include modules that actually export a function
      .filter(op => {
        return /export function ([A-Z]*)/i.exec(op.srcFileContents);
      })
      /**
      * Check if the operator should be static, assuming the path contains -static.
      **/
      .map(checkStatic)
      // Get the exported function name
      .map(getOperatorName)
      // Get the default name of the operator as it should appear on Observable
      .map(getNameOnOperatorProto)
      // Get any special-case aliases that should be applied
      .map(getAliases)
      // Mark operator as extended, if applicable
      .map(checkExtended)
      .map(generateNewOperatorFileContents)
      .forEach(writeToDisk);
    // Repeat the process for src/observable/*
    mkdirp('./src/add/observable', () => {
      fs.readdirSync('./src/observable')
        .map(o => {
          return {
            path: o,
            methodType: MethodType.Observable
          }
        })
        .map(loadSrcFile)
        .filter(checkForCreate)
        .map(getClassName)
        .map(getNameOnObservableProto)
        .map(getAliases)
        .map(generateNewObservableFileContents)
        .map(writeToDisk);
    });
  });
}
