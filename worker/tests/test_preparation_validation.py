import pytest
from worker.model_preparation import PreparationError
from worker.preparation_validation import compare_values, validation_scenarios, scenario_inputs


def model():
    return {'fields':[
      {'id':'fluid','cell':'A1','label':'Fluid','type':'select','required':True,'default':'Gas','options':['Gas','Oil'],'role':'primaryFluid'},
      {'id':'unit','cell':'A2','label':'Unit','type':'select','required':True,'default':'m3','options':['m3','bbl'],'dependsOn':'fluid','optionsByDependencyValue':{'Gas':['m3'],'Oil':['bbl']}},
      {'id':'price','cell':'A3','label':'Price multiplier','type':'number','required':True,'default':1,'min':0}], 'multipliers':['price']}


def test_runtime_checks_change_values_without_claiming_excel_parity():
    manifest=model();cases=validation_scenarios(manifest,{})
    assert len(cases)==2
    alternate=next(case for case in cases if case['changes'].get('A1')=='Oil')
    assert scenario_inputs(manifest,alternate)=={'fluid':'Oil','unit':'bbl','price':1}
    assert manifest['fields'][0]['default']=='Gas'


def test_administrator_cases_are_bounded_and_use_explicit_mapped_cells():
    case={'name':'Selected sensitivity','changes':{'A3':.9}}
    assert validation_scenarios(model(),{'testCases':[case]})==[case]
    with pytest.raises(PreparationError):validation_scenarios(model(),{'testCases':[{'name':'Wrong','changes':{'Z99':5}}]})
    with pytest.raises(PreparationError):validation_scenarios(model(),{'testCases':[]})


def test_comparison_rejects_numerical_shape_and_missing_value_changes():
    assert compare_values({'value':1.000000001},{'value':1})['passed']
    difference=compare_values({'values':[10,None]},{'values':[1,0]})
    assert not difference['passed'] and len(difference['differences'])==2
    assert not compare_values({'value':1},{'value':1,'extra':2})['passed']
    assert not compare_values(float('nan'),0)['passed']
