import { fromEvent, Observable } from 'rxjs';
import { mapTo } from 'rxjs/operators';
import { Writeable } from './control';
import { Elements } from './elements';
import { RxForm } from './rx-form';
import { findParentForm } from './utils';

interface RxSubmitDomPrivate {
  parentForm: RxForm | null;
}

const domPrivateData: WeakMap<RxSubmit, RxSubmitDomPrivate> = new WeakMap();

function createDomPrivate(instance: RxSubmit, data: RxSubmitDomPrivate): void {
  domPrivateData.set(instance, data);
}

function getDomPrivate(instance: RxSubmit): RxSubmitDomPrivate {
  const data = domPrivateData.get(instance);
  if (data === undefined) {
    throw new Error('Something wrong =(');
  }

  return data;
}

export class RxSubmit extends HTMLButtonElement {
  /** Тэг */
  static readonly tagName = Elements.RxSubmit;

  /** Observable, который эмитирует новые значения при клике по кнопке */
  readonly rxClick: Observable<void>;

  setup(this: Writeable<RxSubmit>): void {
    if (this.rxClick) {
      return;
    }

    this.rxClick = fromEvent(this, 'click').pipe(mapTo(undefined));
  }

  /** @internal */
  connectedCallback() {
    // TODO: После того, как Safari научится поддерживать Custom Elements v1, убрать от сюда и добавить конструктор
    this.setup();

    const parentForm = findParentForm(this);
    createDomPrivate(this, { parentForm });

    if (parentForm) {
      parentForm.addSubmitButton(this);
    }
  }

  /** @internal */
  disconnectedCallback() {
    // TODO: После того, как Safari научится поддерживать Custom Elements v1, убрать от сюда и добавить конструктор
    this.setup();

    const domData = getDomPrivate(this);

    if (domData.parentForm) {
      domData.parentForm.removeSubmitButton(this);
    }

    domData.parentForm = null;
  }
}

customElements.define(RxSubmit.tagName, RxSubmit, { extends: 'button' });
