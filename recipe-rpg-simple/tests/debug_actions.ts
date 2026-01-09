
import * as actions from '../app/actions';

console.log('Keys in actions:', Object.keys(actions));
if (typeof actions.createSingleItemRecipeAction === 'function') {
    console.log('createSingleItemRecipeAction is a function');
} else {
    console.log('createSingleItemRecipeAction is:', typeof actions.createSingleItemRecipeAction);
}
