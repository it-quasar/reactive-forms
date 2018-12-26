import { parse } from 'json5';
import { endsWith, isEqual, isString, startsWith } from 'lodash';
import { BehaviorSubject, combineLatest, fromEvent, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, takeUntil } from 'rxjs/operators';
import { createTextMaskInputElement } from 'text-mask-core';
import { pattern, Validators } from '../validators';
import { maxLength } from '../validators/validator-max-length';
import { minLength } from '../validators/validator-min-length';
import {
  checkControlRequiredAttributes,
  Control,
  ControlBehaviourSubjects,
  controlConnectedCallback,
  controlDisconnectedCallback,
  controlObservedAttributes,
  createControlObservables,
  removeValidator,
  setValidator,
  subscribeToControlObservables,
  unsubscribeFromObservables,
  updateControlAttributesBehaviourSubjects,
  ValidatorsMap,
} from './control';
import { updateAttribute } from './utils';

enum RxTextInputAttributes {
  Mask = 'mask',
  Pattern = 'pattern',
  MaxLength = 'maxlength',
  MinLength = 'minlength',
}

function throwInvalidMaxLength() {
  throw new Error(`Attribute "${RxTextInputAttributes.MaxLength}" of <${RxTextInput.tagName}> must be number.`);
}

function throwInvalidMinLength() {
  throw new Error(`Attribute "${RxTextInputAttributes.MinLength}" of <${RxTextInput.tagName}> must be number.`);
}

function subscribeToValueChanges(control: RxTextInput): void {
  const textInputMaskElement$ = control.rxMask.pipe(
    map(mask => {
      if (!mask) {
        return null;
      }

      return createTextMaskInputElement({
        inputElement: control,
        mask,
      });
    }),
  );

  const onInput$ = fromEvent(control, 'input');
  combineLatest(onInput$, textInputMaskElement$)
    .pipe(takeUntil(control.rxDisconnected))
    .subscribe(([_, textInputMaskElement]) => {
      if (textInputMaskElement === null) {
        control.setValue(control.value);
        return;
      }

      textInputMaskElement.update(control.value);
      control.setValue(control.value);
    });
}

function setValidators(control: RxTextInput): void {
  control.rxPattern.pipe(takeUntil(control.rxDisconnected)).subscribe(regExp => {
    if (!regExp) {
      control.removeValidator(Validators.Pattern);
    } else {
      control.setValidator(Validators.Pattern, pattern(control.rxValue, regExp));
    }
  });

  control.rxMaxLength.pipe(takeUntil(control.rxDisconnected)).subscribe(length => {
    if (!length) {
      control.removeValidator(Validators.MaxLength);
    } else {
      control.setValidator(Validators.MaxLength, maxLength(control.rxValue, length));
    }
  });

  control.rxMinLength.pipe(takeUntil(control.rxDisconnected)).subscribe(length => {
    if (!length) {
      control.removeValidator(Validators.MinLength);
    } else {
      control.setValidator(Validators.MinLength, minLength(control.rxValue, length));
    }
  });
}

function subscribeToAttributeObservables(control: RxTextInput): void {
  control.rxMask.pipe(takeUntil(control.rxDisconnected)).subscribe(mask => {
    const stringMask = mask ? mask.map(element => `'${element.toString()}'`).join(', ') : null;
    updateAttribute(control, RxTextInputAttributes.Mask, stringMask ? `[${stringMask}]` : null);
  });

  control.rxPattern.pipe(takeUntil(control.rxDisconnected)).subscribe(regExp => {
    updateAttribute(control, RxTextInputAttributes.Pattern, regExp ? regExp.toString() : null);
  });

  control.rxMaxLength.pipe(takeUntil(control.rxDisconnected)).subscribe(length => {
    updateAttribute(control, RxTextInputAttributes.MaxLength, length ? length.toString() : null);
  });

  control.rxMinLength.pipe(takeUntil(control.rxDisconnected)).subscribe(length => {
    updateAttribute(control, RxTextInputAttributes.MinLength, length ? length.toString() : null);
  });
}

function maskStringToArray(maskString: string): Array<string | RegExp> {
  let maskStringArray: string[];

  const throwSyntaxError = (mask: string) => {
    return new Error(
      `Error on parse mask "${mask}", check syntax. ` +
        `Mask must contains array of strings and RegExp's. RegExp must be in quotes ('/\\d/').`,
    );
  };

  try {
    maskStringArray = parse(`{mask: ${maskString.replace(/\\/g, '\\\\')}}`).mask;
  } catch (e) {
    throw throwSyntaxError(maskString);
  }

  if (maskStringArray.some(element => !isString(element))) {
    throw throwSyntaxError(maskString);
  }

  return maskStringArray.map((element: string) => {
    if (startsWith(element, '/') && endsWith(element, '/')) {
      return new RegExp(element.substr(1, element.length - 2));
    }

    return element;
  });
}

function stringToRegExp(stringRegExp: string): RegExp {
  if (startsWith(stringRegExp, '/') && endsWith(stringRegExp, '/')) {
    return new RegExp(stringRegExp.substr(1, stringRegExp.length - 2));
  } else {
    return new RegExp(stringRegExp);
  }
}

interface RxTextInputPrivate extends ControlBehaviourSubjects<string> {
  readonly value$: BehaviorSubject<string>;
  readonly mask$: BehaviorSubject<Array<string | RegExp> | null>;
  readonly pattern$: BehaviorSubject<RegExp | null>;
  readonly maxLength$: BehaviorSubject<number | null>;
  readonly minLength$: BehaviorSubject<number | null>;
}

const privateData: WeakMap<RxTextInput, RxTextInputPrivate> = new WeakMap();

function createPrivate(instance: RxTextInput): RxTextInputPrivate {
  const data = {
    disconnected$: new Subject<void>(),
    mask$: new BehaviorSubject<Array<string | RegExp> | null>(null),
    maxLength$: new BehaviorSubject<number | null>(null),
    minLength$: new BehaviorSubject<number | null>(null),
    name$: new BehaviorSubject<string>(''),
    pattern$: new BehaviorSubject<RegExp | null>(null),
    pristine$: new BehaviorSubject(true),
    readonly$: new BehaviorSubject<boolean>(false),
    required$: new BehaviorSubject<boolean>(false),
    untouched$: new BehaviorSubject(true),
    validators$: new BehaviorSubject<ValidatorsMap>(new Map()),
    value$: new BehaviorSubject<string>(instance.value),
  };

  privateData.set(instance, data);

  return data;
}

function getPrivate(instance: RxTextInput): RxTextInputPrivate {
  const data = privateData.get(instance);
  if (data === undefined) {
    throw new Error('Something wrong =(');
  }

  return data;
}

function subscribeToObservables(control: RxTextInput): void {
  subscribeToValueChanges(control);
  subscribeToAttributeObservables(control);

  fromEvent(control, 'blur')
    .pipe(takeUntil(control.rxDisconnected))
    .subscribe(() => control.markAsTouched());
}

/**
 * Поле ввода текста
 */
export class RxTextInput extends HTMLInputElement implements Control<string> {
  /** Тэг */
  static readonly tagName: string = 'rx-text-input';

  /** @internal */
  static readonly observedAttributes = [
    ...controlObservedAttributes,
    RxTextInputAttributes.Pattern,
    RxTextInputAttributes.Mask,
    RxTextInputAttributes.MaxLength,
    RxTextInputAttributes.MinLength,
  ];

  /**
   * Маска
   */
  readonly rxMask: Observable<Array<string | RegExp> | null>;
  /**
   * Паттер для валидации
   */
  readonly rxPattern: Observable<RegExp | null>;
  /**
   * Максимальная длина
   */
  readonly rxMaxLength: Observable<number | null>;
  /**
   * Минимальная длина
   */
  readonly rxMinLength: Observable<number | null>;

  readonly rxDisconnected: Observable<void>;
  readonly rxDirty: Observable<boolean>;
  readonly rxInvalid: Observable<boolean>;
  readonly rxName: Observable<string>;
  readonly rxPristine: Observable<boolean>;
  readonly rxReadonly: Observable<boolean>;
  readonly rxRequired: Observable<boolean>;
  readonly rxTouched: Observable<boolean>;
  readonly rxUntouched: Observable<boolean>;
  readonly rxValid: Observable<boolean>;
  readonly rxValidationErrors: Observable<string[]>;
  readonly rxValue: Observable<string>;

  constructor() {
    super();

    checkControlRequiredAttributes(this, RxTextInput.tagName);

    const data = createPrivate(this);

    const observables = createControlObservables(data);
    this.rxDisconnected = observables.rxDisconnected;
    this.rxName = observables.rxName;
    this.rxReadonly = observables.rxReadonly;
    this.rxRequired = observables.rxRequired;
    this.rxValue = observables.rxValue;
    this.rxPristine = observables.rxPristine;
    this.rxDirty = observables.rxDirty;
    this.rxUntouched = observables.rxUntouched;
    this.rxTouched = observables.rxTouched;
    this.rxValid = observables.rxValid;
    this.rxInvalid = observables.rxInvalid;
    this.rxValidationErrors = observables.rxValidationErrors;

    this.rxMask = getPrivate(this)
      .mask$.asObservable()
      .pipe(
        distinctUntilChanged(isEqual),
        shareReplay(1),
      );

    this.rxPattern = getPrivate(this)
      .pattern$.asObservable()
      .pipe(
        distinctUntilChanged(isEqual),
        shareReplay(1),
      );

    this.rxMaxLength = getPrivate(this)
      .maxLength$.asObservable()
      .pipe(
        distinctUntilChanged(isEqual),
        shareReplay(1),
      );

    this.rxMinLength = getPrivate(this)
      .minLength$.asObservable()
      .pipe(
        distinctUntilChanged(isEqual),
        shareReplay(1),
      );

    setValidators(this);
  }

  markAsDirty(): void {
    getPrivate(this).pristine$.next(false);
  }

  markAsPristine(): void {
    getPrivate(this).pristine$.next(true);
  }

  markAsTouched(): void {
    getPrivate(this).untouched$.next(false);
  }

  markAsUnTouched(): void {
    getPrivate(this).untouched$.next(true);
  }

  removeValidator(validator: string): void {
    removeValidator(getPrivate(this), validator);
  }

  setName(name: string): void {
    getPrivate(this).name$.next(name);
  }

  setReadonly(readonly: boolean): void {
    getPrivate(this).readonly$.next(readonly);
  }

  setRequired(required: boolean): void {
    getPrivate(this).required$.next(required);
  }

  setValidator(name: string, validator: Observable<boolean>): void {
    setValidator(getPrivate(this), name, validator);
  }

  setValue(value: string): void {
    getPrivate(this).value$.next(value);
    this.value = value;
    this.markAsDirty();
  }

  /**
   * Устанавливает маску
   *
   * @param mask Маска
   */
  setMask(mask: Array<string | RegExp> | null) {
    getPrivate(this).mask$.next(mask);
  }

  /**
   * Устанавливает паттер для валидации
   *
   * @param regExp Паттер для валидации
   */
  setPattern(regExp: RegExp | null) {
    getPrivate(this).pattern$.next(regExp);
  }

  /**
   * Устанавливает максимальную длину
   *
   * @param length Максимальная длина
   */
  setMaxLength(length: number | null) {
    getPrivate(this).maxLength$.next(length);
  }

  /**
   * Устанавливает минимальную длину
   *
   * @param length Минимальная длина
   */
  setMinLength(length: number | null) {
    getPrivate(this).minLength$.next(length);
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (newValue === oldValue) {
      return;
    }

    switch (name) {
      case RxTextInputAttributes.Mask:
        this.setMask(newValue !== null ? maskStringToArray(newValue) : null);
        break;
      case RxTextInputAttributes.Pattern:
        this.setPattern(newValue !== null ? stringToRegExp(newValue) : null);
        break;
      case RxTextInputAttributes.MaxLength: {
        const length = newValue ? parseInt(newValue, 10) : null;
        if (length !== null && Number.isNaN(length)) {
          throw throwInvalidMaxLength();
        }

        this.setMaxLength(length);
        break;
      }
      case RxTextInputAttributes.MinLength: {
        const length = newValue ? parseInt(newValue, 10) : null;
        if (length !== null && Number.isNaN(length)) {
          throw throwInvalidMinLength();
        }

        this.setMinLength(length);
        break;
      }
      default:
        updateControlAttributesBehaviourSubjects(this, name, RxTextInput.tagName, newValue);
        break;
    }
  }

  /** @internal */
  connectedCallback() {
    controlConnectedCallback(this, RxTextInput.tagName);

    subscribeToControlObservables(this, this, RxTextInput.tagName);
    subscribeToObservables(this);
  }

  /** @internal */
  disconnectedCallback() {
    controlDisconnectedCallback(this, RxTextInput.tagName);

    unsubscribeFromObservables(getPrivate(this));
  }
}

customElements.define(RxTextInput.tagName, RxTextInput, { extends: 'input' });
