import { Arr, Fun, Merger, Obj, Optional, Thunk, Type } from '@ephox/katamari';
import { SimpleResult, SimpleResultType } from '../alien/SimpleResult';
import * as FieldPresence from '../api/FieldPresence';
import { ResultCombine } from '../combine/ResultCombine';
import * as SchemaError from './SchemaError';
import * as ValuePresence from './ValuePresence';

type SchemaError = SchemaError.SchemaError;

export type ValueValidator = (a) => SimpleResult<string, any>;
export type PropExtractor = (path: string[], val: any) => SimpleResult<SchemaError[], any>;
export type ValueExtractor = (label: string, prop: Processor, obj: any) => SimpleResult<SchemaError[], string>;
type Bundle<T> = (val: T) => SimpleResult<SchemaError[], T>;

export interface Processor {
  readonly extractProp: PropExtractor;
  readonly toString: () => string;
}

const output = (newKey: string, value: any): ValuePresence.StateProcessorData => ValuePresence.state(newKey, Fun.constant(value));

const snapshot = (newKey: string): ValuePresence.StateProcessorData => ValuePresence.state(newKey, Fun.identity);

const strictAccess = <T>(path: string[], obj: Record<string, T>, key: string, bundle: Bundle<T>): SimpleResult<SchemaError[], T> => {
  // In strict mode, if it undefined, it is an error.
  return Obj.get(obj, key).fold<SimpleResult<SchemaError[], any>>(
    () => SchemaError.missingStrict(path, key, obj),
    bundle
  );
};

const fallbackAccess = <T>(obj: Record<string, T>, key: string, fallbackThunk: (obj: Record<string, T>) => T, bundle: Bundle<T>): SimpleResult<SchemaError[], T> => {
  const v = Obj.get(obj, key).fold(() => fallbackThunk(obj), Fun.identity);
  return bundle(v);
};

const optionAccess = <T>(obj: Record<string, T>, key: string, bundle: Bundle<Optional<T>>): SimpleResult<SchemaError[], Optional<T>> =>
  bundle(Obj.get(obj, key));

const optionDefaultedAccess = <T>(obj: Record<string, T | true>, key: string, fallback: (obj: Record<string, T | true>) => T, bundle: Bundle<Optional<T>>): SimpleResult<SchemaError[], Optional<T>> => {
  const opt = Obj.get(obj, key).map((val) => val === true ? fallback(obj) : val);
  return bundle(opt);
};

type SimpleBundle = SimpleResult<SchemaError[], any>;
type OptionBundle = SimpleResult<SchemaError[], Optional<any>>;

const extractField = <T>(field: FieldPresence.FieldPresenceTypes, path: string[], obj: Record<string, T>, key: string, newKey: string, prop: Processor): SimpleResult<SchemaError[], any> => {
  const bundle = (av: any): SimpleBundle => prop.extractProp(path.concat([ key ]), av);

  const bundleAsOption = (optValue: Optional<any>): OptionBundle => {
    return optValue.fold(
      () => SimpleResult.svalue(Optional.none()),
      (ov) => {
        const result = prop.extractProp(path.concat([ key ]), ov);
        return SimpleResult.map(result, Optional.some);
      }
    );
  };

  switch (field.discriminator) {
    case 'strict':
      return strictAccess(path, obj, key, bundle);
    case 'defaultedThunk':
      return fallbackAccess(obj, key, field.callback, bundle);
    case 'asOption':
      return optionAccess(obj, key, bundleAsOption);
    case 'asDefaultedOptionThunk':
      return optionDefaultedAccess(obj, key, field.callback, bundleAsOption);
    case 'mergeWithThunk': {
      return fallbackAccess(obj, key, Fun.constant({}), (v) => {
        const result = Merger.deepMerge(field.callback(obj), v);
        return bundle(result);
      });
    }
  }
};

const cExtract = <T>(path: string[], obj: Record<string, T>, fields: ValuePresence.ValueProcessorTypes[]): SimpleResult<SchemaError[], Record<string, T>> => {
  const success: Record<string, T> = {};
  const errors: SchemaError[] = [];

  // Note: We use a for loop here instead of Arr.each for performance
  for (const field of fields) {
    ValuePresence.fold(
      field,
      (key, newKey, presence, prop) => {
        const result = extractField(presence, path, obj, key, newKey, prop);
        SimpleResult.fold(result,
          (err) => errors.push(...err),
          (res) => success[newKey] = res
        );
      },
      (newKey, instantiator) => {
        success[newKey] = instantiator(obj);
      }
    );
  }
  return errors.length > 0 ? SimpleResult.serror(errors) : SimpleResult.svalue(success);
};

const valueThunk = (getDelegate: () => Processor): Processor => {
  const extract = (path: string[], val: any) => getDelegate().extractProp(path, val);

  const toString = () => getDelegate().toString();

  return {
    extractProp: extract,
    toString
  };
};

const value = (validator: ValueValidator): Processor => {
  const extract = (path, val) => {
    return SimpleResult.bindError(
      validator(val),
      (err) => SchemaError.custom(path, err)
    );
  };

  const toString = () => 'val';

  return {
    extractProp: extract,
    toString
  };
};

// This is because Obj.keys can return things where the key is set to undefined.
const getSetKeys = (obj) => Obj.keys(Obj.filter(obj, (value) => value !== undefined && value !== null));

const objOfOnly = (fields: ValuePresence.ValueProcessorTypes[]): Processor => {
  const delegate = objOf(fields);

  const fieldNames = Arr.foldr<ValuePresence.ValueProcessorTypes, Record<string, string>>(fields, (acc, value: ValuePresence.ValueProcessorTypes) => {
    return ValuePresence.fold(
      value,
      (key) => Merger.deepMerge(acc, { [key]: true }),
      Fun.constant(acc)
    );
  }, {});

  const extract = (path, o) => {
    const keys = Type.isBoolean(o) ? [] : getSetKeys(o);
    const extra = Arr.filter(keys, (k) => !Obj.hasNonNullableKey(fieldNames, k));

    return extra.length === 0 ? delegate.extractProp(path, o) : SchemaError.unsupportedFields(path, extra);
  };

  return {
    extractProp: extract,
    toString: delegate.toString
  };
};

const objOf = (values: ValuePresence.ValueProcessorTypes[]): Processor => {
  const extract = (path: string[], o: Record<string, any>) => cExtract(path, o, values);

  const toString = () => {
    const fieldStrings = Arr.map(values, (value) => ValuePresence.fold(
      value,
      (key, _okey, _presence, prop) => key + ' -> ' + prop.toString(),
      (newKey, _instantiator) => 'state(' + newKey + ')'
    ));
    return 'obj{\n' + fieldStrings.join('\n') + '}';
  };

  return {
    extractProp: extract,
    toString
  };
};

const arrOf = (prop: Processor): Processor => {
  const extract = (path, array) => {
    const results = Arr.map(array, (a, i) => prop.extractProp(path.concat([ '[' + i + ']' ]), a));
    return ResultCombine.consolidateArr(results);
  };

  const toString = () => 'array(' + prop.toString() + ')';

  return {
    extractProp: extract,
    toString
  };
};

const oneOf = (props: Processor[]): Processor => {
  const extract = (path: string[], val: any): SimpleResult<SchemaError[], any> => {
    const errors: Array<SimpleResult<SchemaError[], any>> = [];

    // Return on first match
    for (const prop of props) {
      const res = prop.extractProp(path, val);
      if (res.stype === SimpleResultType.Value) {
        return res;
      }
      errors.push(res);
    }

    // All failed, return errors
    return ResultCombine.consolidateArr(errors);
  };

  const toString = () => 'oneOf(' + Arr.map(props, (prop) => prop.toString()).join(', ') + ')';

  return {
    extractProp: extract,
    toString
  };
};

const setOf = (validator: ValueValidator, prop: Processor): Processor => {
  const validateKeys = (path, keys) => arrOf(value(validator)).extractProp(path, keys);
  const extract = (path, o) => {
    //
    const keys = Obj.keys(o);
    const validatedKeys = validateKeys(path, keys);
    return SimpleResult.bind(validatedKeys, (validKeys) => {
      const schema = Arr.map(validKeys, (vk) => {
        return ValuePresence.field(vk, vk, FieldPresence.strict(), prop);
      });

      return objOf(schema).extractProp(path, o);
    });
  };

  const toString = () => 'setOf(' + prop.toString() + ')';

  return {
    extractProp: extract,
    toString
  };
};

// retriever is passed in. See funcOrDie in ValueSchema
const func = (args: string[], _schema: Processor, retriever: (obj: any) => any): Processor => {
  const delegate = value((f) => {
    return Type.isFunction(f) ? SimpleResult.svalue<any, () => any>((...gArgs: any[]) => {
      const allowedArgs = gArgs.slice(0, args.length);
      const o = f.apply(null, allowedArgs);
      return retriever(o);
    }) : SimpleResult.serror('Not a function');
  });

  return {
    extractProp: delegate.extractProp,
    toString: Fun.constant('function')
  };
};

const thunk = (_desc: string, processor: () => Processor): Processor => {
  const getP = Thunk.cached(processor);

  const extract = (path: string[], val: any) => getP().extractProp(path, val);

  const toString = () => getP().toString();

  return {
    extractProp: extract,
    toString
  };
};

const anyValue = Fun.constant(value(SimpleResult.svalue));
const arrOfObj = Fun.compose(arrOf, objOf);

export {
  anyValue,
  value,
  valueThunk,

  objOf,
  objOfOnly,
  arrOf,
  oneOf,
  setOf,
  arrOfObj,

  output,
  snapshot,
  thunk,
  func
};
