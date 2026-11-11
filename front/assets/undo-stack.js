/* undo-stack.js — pile d'annulation PURE (annuler seulement, PAS de « refaire »).
 *
 * Règles (cf. retours Manu) :
 *  - le bouton « Annuler » n'est visible QUE si la pile n'est pas vide
 *    (`isEmpty` -> le shell masque le bouton via `onChange`) ;
 *  - `reset()` quand on quitte le formulaire (changement d'écran/onglet) ;
 *  - aucune notion de redo.
 *
 * Module pur (aucun DOM) : testable sous Node.
 */
export class UndoStack {
  constructor(onChange) {
    this._items = [];
    this._onChange = typeof onChange === "function" ? onChange : () => {};
  }

  get size() {
    return this._items.length;
  }

  get isEmpty() {
    return this._items.length === 0;
  }

  /** Empile une action d'annulation (fonction, éventuellement async). */
  push(undoFn) {
    this._items.push(undoFn);
    this._onChange();
  }

  /** Dépile et exécute la dernière action. Retourne false si la pile était vide. */
  async undo() {
    const fn = this._items.pop();
    this._onChange();
    if (!fn) return false;
    await fn();
    return true;
  }

  /** Vide la pile (sortie de formulaire). */
  reset() {
    if (this._items.length === 0) {
      this._onChange();
      return;
    }
    this._items.length = 0;
    this._onChange();
  }
}
