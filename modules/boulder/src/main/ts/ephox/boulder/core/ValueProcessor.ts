import { Arr, Fun, Merger, Obj, Optional, Thunk, Type } from '@ephox/katamari';
import { SimpleResult, SimpleResultType } from '../alien/SimpleResult';
import * as FieldPresence from '../api/FieldPresence';
import * as Objects from '../api/Objects';
import { ResultCombine } from '../combine/ResultCombine';
import * as ObjWriter from './ObjWriter';
import * as SchemaError from './SchemaError';
import * as ValuePresence from './ValuePresence';

type SchemaError = SchemaError.SchemaError;

// TODO: Handle the fact that strength shouldn't be pushed outside this project.
export type Strength = (res: any) => any;
export type ValueValidator = (a, strength?: Strength) => SimpleResult<string, any>;
export type PropExtractor = (path: string[], strength: Strength, val: any) => SimpleResult<SchemaError[], any>;
export type ValueExtractor = (label: string, prop: Processor, strength: Strength, obj: any) => SimpleResult<SchemaError[], string>;
export interface Processor {
  extract: PropExtractor;
  toString: () => string;
}

const output = (okey: string, value: any): ValuePresence.StateProcessorData => ValuePresence.state(okey, Fun.constant(value));

const snapshot = (okey: string): ValuePresence.StateProcessorData => ValuePresence.state(okey, Fun.identity);

const strictAccess = <T>(path: string[], obj: Record<string, T>, key: string): SimpleResult<SchemaError[], T> => {
  // In strict mode, if it undefined, it is an error.
  return Obj.get(obj, key).fold<SimpleResult<SchemaError[], any>>(() =>
    SchemaError.missingStrict(path, key, obj), SimpleResult.svalue);
};

const fallbackAccess = <T>(obj: Record<string, T>, key: string, fallbackThunk: (obj: Record<string, T>) => T): SimpleResult<SchemaError[], T> => {
  const v = Obj.get(obj, key).fold(() => fallbackThunk(obj), Fun.identity);
  return SimpleResult.svalue(v);
};

const optionAccess = <T>(obj: Record<string, T>, key: string): SimpleResult<SchemaError[], Optional<T>> =>
  SimpleResult.svalue(Obj.get(obj, key));

const optionDefaultedAccess = <T>(obj: Record<string, T | true>, key: string, fallback: (obj: Record<string, T | true>) => T): SimpleResult<SchemaError[], Optional<T>> => {
  const opt = Obj.get(obj, key).map((val) => val === true ? fallback(obj) : val);
  return SimpleResult.svalue(opt);
};

type SimpleBundle = SimpleResult<SchemaError[], any>;
type OptionBundle = SimpleResult<SchemaError[], Record<string, Optional<any>>>;

const cExtractOne = <T>(path: string[], obj: Record<string, T>, value: ValuePresence.ValueProcessorTypes, strength: Strength): SimpleResult<SchemaError[], T> => {
  return ValuePresence.fold(
    value,
    (key, okey, presence, prop) => {
      const bundle = (av: any): SimpleBundle => {
        const result = prop.extract(path.concat([ key ]), strength, av);
        return SimpleResult.map(result, (res) => ObjWriter.wrap(okey, strength(res)));
      };

      const bundleAsOption = (optValue: Optional<any>): OptionBundle => {
        return optValue.fold(() => {
          const outcome = ObjWriter.wrap(okey, strength(Optional.none()));
          return SimpleResult.svalue(outcome);
        }, (ov) => {
          const result: SimpleResult<any, any> = prop.extract(path.concat([ key ]), strength, ov);
          return SimpleResult.map(result, (res) => {
            return ObjWriter.wrap(okey, strength(Optional.some(res)));
          });
        });
      };

      const processPresence = (presence: FieldPresence.FieldPresenceTypes) => {
        switch (presence.discriminator) {
          case 'strict':
            return SimpleResult.bind(
              strictAccess(path, obj, key),
              bundle
            );
          case 'defaultedThunk':
            return SimpleResult.bind(
              fallbackAccess(obj, key, presence.callback),
              bundle
            );
          case 'asOption':
            return SimpleResult.bind(
              optionAccess(obj, key),
              bundleAsOption
            );
          case 'asDefaultedOptionThunk':
            return SimpleResult.bind(
              optionDefaultedAccess(obj, key, presence.callback),
              bundleAsOption
            );
          case 'mergeWithThunk': {
            const base = presence.callback(obj);
            const result = SimpleResult.map(
              fallbackAccess(obj, key, Fun.constant({})),
              (v) => Merger.deepMerge(base, v)
            );
            return SimpleResult.bind(result, bundle);
          }
        }
      };

      return (() => processPresence(presence))();
    },
    (okey, instantiator) => {
      const state = instantiator(obj);
      return SimpleResult.svalue(ObjWriter.wrap(okey, strength(state)));
    }
  );
};

const cExtract = <T>(path: string[], obj: Record<string, T>, fields: ValuePresence.ValueProcessorTypes[], strength: Strength): SimpleResult<SchemaError[], T> => {
  const results = Arr.map(fields, (field) => cExtractOne(path, obj, field, strength));
  return ResultCombine.consolidateObj(results, {});
};

const valueThunk = (getDelegate: () => Processor): Processor => {
  const extract = (path, strength, val) => getDelegate().extract(path, strength, val);

  const toString = () => getDelegate().toString();

  return {
    extract,
    toString
  };
};

const value = (validator: ValueValidator): Processor => {
  const extract = (path, strength, val) => {
    return SimpleResult.bindError(
      // NOTE: Intentionally allowing strength to be passed through internally
      validator(val, strength),
      (err) => SchemaError.custom(path, err)
    );
  };

  const toString = () => 'val';

  return {
    extract,
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
      (key) => Merger.deepMerge(acc, Objects.wrap(key, true)),
      Fun.constant(acc)
    );
  }, {});

  const extract = (path, strength, o) => {
    const keys = Type.isBoolean(o) ? [] : getSetKeys(o);
    const extra = Arr.filter(keys, (k) => !Obj.hasNonNullableKey(fieldNames, k));

    return extra.length === 0 ? delegate.extract(path, strength, o) :
      SchemaError.unsupportedFields(path, extra);
  };

  return {
    extract,
    toString: delegate.toString
  };
};

const objOf = (values: ValuePresence.ValueProcessorTypes[]): Processor => {
  const extract = (path: string[], strength: Strength, o: Record<string, any>) => cExtract(path, o, values, strength);

  const toString = () => {
    const fieldStrings = Arr.map(values, (value) => ValuePresence.fold(
      value,
      (key, _okey, _presence, prop) => key + ' -> ' + prop.toString(),
      (okey, _instantiator) => 'state(' + okey + ')'
    ));
    return 'obj{\n' + fieldStrings.join('\n') + '}';
  };

  return {
    extract,
    toString
  };
};

const arrOf = (prop: Processor): Processor => {
  const extract = (path, strength, array) => {
    const results = Arr.map(array, (a, i) => prop.extract(path.concat([ '[' + i + ']' ]), strength, a));
    return ResultCombine.consolidateArr(results);
  };

  const toString = () => 'array(' + prop.toString() + ')';

  return {
    extract,
    toString
  };
};

const oneOf = (props: Processor[]): Processor => {
  const extract = (path: string[], strength, val: any): SimpleResult<SchemaError[], any> => {
    const errors: Array<SimpleResult<SchemaError[], any>> = [];

    // Return on first match
    for (const prop of props) {
      const res = prop.extract(path, strength, val);
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
    extract,
    toString
  };
};

const setOf = (validator: ValueValidator, prop: Processor): Processor => {
  const validateKeys = (path, keys) => arrOf(value(validator)).extract(path, Fun.identity, keys);
  const extract = (path, strength, o) => {
    //
    const keys = Obj.keys(o);
    const validatedKeys = validateKeys(path, keys);
    return SimpleResult.bind(validatedKeys, (validKeys) => {
      const schema = Arr.map(validKeys, (vk) => {
        return ValuePresence.field(vk, vk, FieldPresence.strict(), prop);
      });

      return objOf(schema).extract(path, strength, o);
    });
  };

  const toString = () => 'setOf(' + prop.toString() + ')';

  return {
    extract,
    toString
  };
};

// retriever is passed in. See funcOrDie in ValueSchema
const func = (args: string[], _schema: Processor, retriever: (obj: any, strength: Strength) => any): Processor => {
  const delegate = value((f, strength) => {
    return Type.isFunction(f) ? SimpleResult.svalue<any, () => any>((...gArgs: any[]) => {
      const allowedArgs = gArgs.slice(0, args.length);
      const o = f.apply(null, allowedArgs);
      return retriever(o, strength);
    }) : SimpleResult.serror('Not a function');
  });

  return {
    extract: delegate.extract,
    toString: Fun.constant('function')
  };
};

const thunk = (_desc: string, processor: () => Processor): Processor => {
  const getP = Thunk.cached(() => processor());

  const extract = (path, strength, val) => getP().extract(path, strength, val);

  const toString = () => getP().toString();

  return {
    extract,
    toString
  };
};

const anyValue = Fun.constant(value(SimpleResult.svalue));
const arrOfObj = Fun.compose(arrOf, objOf);

const state = ValuePresence.state; // remove, use directly
const field = ValuePresence.field;

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

  state,
  field,
  output,
  snapshot,
  thunk,
  func
};
