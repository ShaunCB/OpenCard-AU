import {conoutInfo, conoutError, conoutWarn} from '../../conout/actions'
import {createConoutError, checkExposedHeaders} from '../../../utils/cors'
import {encodeRFC3986URIComponent} from '../../../utils/url'

export const START_RETRIEVE_PRODUCT_LIST = 'START_RETRIEVE_PRODUCT_LIST'
export const RETRIEVE_PRODUCT_LIST = 'RETRIEVE_PRODUCT_LIST'
export const RETRIEVE_PRODUCT_DETAIL = 'RETRIEVE_PRODUCT_DETAIL'
export const RETRIEVE_ALL_PRODUCT_DETAILS = 'RETRIEVE_ALL_PRODUCT_DETAILS'
export const DELETE_DATA = 'DELETE_DATA'
export const CLEAR_DATA = 'CLEAR_DATA'

import DOMPurify from 'dompurify'

const sanitizeProductData = (data) => {
  if (!data) return data;
  if (data.name) data.name = DOMPurify.sanitize(data.name);
  if (data.description) data.description = DOMPurify.sanitize(data.description);
  if (data.brand) data.brand = DOMPurify.sanitize(data.brand);
  if (data.brandName) data.brandName = DOMPurify.sanitize(data.brandName);
  return data;
};

export const startRetrieveProductList = (dataSourceIdx) => ({
  type: START_RETRIEVE_PRODUCT_LIST,
  payload: {idx: dataSourceIdx}
})

const headers = {
  'Accept': 'application/json'
}

export const retrieveProductList = (dataSourceIdx, baseUrl, productListUrl, xV, xMinV) =>
  (dispatch) => {
    const reqHeaders = new Headers(headers)
    if (xV) reqHeaders.append('x-v', xV)
    if (xMinV) reqHeaders.append('x-min-v', xMinV)
    const request = new Request(productListUrl, {headers: reqHeaders})
    dispatch(conoutInfo(`Requesting retrieveProductList() for ${productListUrl}`))
    let responseXV = xV
    const response = dispatch({
      type: RETRIEVE_PRODUCT_LIST,
      payload: fetch(request)
        .then(response => {
          if (response.ok) {
            checkExposedHeaders(response, productListUrl, dispatch)
            try {
              const headerXV = response.headers.get('x-v')
              if (headerXV) {
                responseXV = headerXV
              }
            } catch (e) {
              responseXV = '5'
            }
            return response.json()
          }
          throw new Error(`Response not OK. Status: ${response.status} (${response.statusText})`)
        })
        .then(obj => {
          dispatch(conoutInfo(`Received retrieveProductList() response for ${productListUrl}:`, obj))
          return obj
        })
        .catch(error => {
          dispatch(createConoutError(error, productListUrl))
          return {
            meta: {totalRecords: 0},
            data: {products: []},
            links: {}
          }
        })
        .then(json => {
          if (json && json.data && json.data.products) {
            json.data.products = json.data.products.filter(p => ['CRED_AND_CHRG_CARDS', 'BUSINESS_CARDS', 'CORPORATE_CARDS'].includes(p.productCategory))
            json.meta = { ...json.meta, totalRecords: json.data.products.length }
            
            // Automatically fetch details for the recommender pre-screener
            json.data.products.forEach(p => {
              dispatch(retrieveProductDetail(dataSourceIdx, baseUrl, p.productId, '7', '1'))
            })
          }
          return {idx: dataSourceIdx, response: json, responseXV: responseXV || '5'}
        })
    })
    response.then(({value})=> {
      const {next} = value.response.links
      const actualXV = value.responseXV || '5'
      if (!!next) {
        if (next === productListUrl) {
          dispatch(conoutError(`The link next should not be the same as the current page URL (${productListUrl}):`, value.response.links))
        } else {
          dispatch(retrieveProductList(dataSourceIdx, baseUrl, next, actualXV, xMinV))
        }
      }
    })
  }

export const retrieveProductDetail = (dataSourceIdx, url, productId, xV, xMinV) => (dispatch, getState) => {
  const fullUrl = url + '/banking/products/' + encodeRFC3986URIComponent(productId)
  dispatch(conoutInfo('Requesting retrieveProductDetail() for product ' + productId))
  const request = new Request(fullUrl, {
    headers: new Headers({
      ...headers,
      'x-v': String(7),
      'x-min-v': String(1),
      'Accept': 'application/json'
    })
  })
  dispatch({
    type: RETRIEVE_PRODUCT_DETAIL,
    payload: fetch(request)
      .then(response => {
        if (response.ok) {
          return response.json()
        }
        throw new Error(`Response not OK. Status: ${response.status} (${response.statusText})`)
      })
      .then(obj => {
        dispatch(conoutInfo(`Received response for ${fullUrl}:`, obj))
        return obj
      })
      .then(json => {
        if (json && json.data) {
          json.data = sanitizeProductData(json.data);
        }
        const { productDetails } = getState().banking[dataSourceIdx]
        const { data } = json
        if (productDetails.some(prod => prod.productId === data.productId
            && prod.productCategory === data.productCategory)) {
          dispatch(conoutWarn(`Product with id ${data.productId} already exists in ${data.productCategory}`))
          return {idx: dataSourceIdx, response: null}
        }
        return {idx: dataSourceIdx, response: json}
      })
      .catch(error => {
        dispatch(createConoutError(error, fullUrl))
        const bankingState = getState().banking[dataSourceIdx]
        const summaryProduct = bankingState && bankingState.products && bankingState.products.find(p => p.productId === productId)
        if (summaryProduct) {
          const stubbedDetail = {
            data: {
              productId: summaryProduct.productId,
              name: summaryProduct.name,
              brand: summaryProduct.brand,
              description: summaryProduct.description,
              productCategory: summaryProduct.productCategory || 'CRED_AND_CHRG_CARDS',
              lastUpdated: summaryProduct.lastUpdated,
              brandName: summaryProduct.brandName,
              applicationUri: summaryProduct.applicationUri,
              isTailored: summaryProduct.isTailored,
              additionalInformation: summaryProduct.additionalInformation,
              cardArt: summaryProduct.cardArt,
              // Map stub data with helpful fallback messages
              features: [{ featureType: 'OTHER', additionalInfo: 'See Provider Website' }],
              fees: [{ name: 'Details Unavailable (CORS/Preflight Mismatch)', feeType: 'EVENT', additionalInfo: 'See Provider Website' }],
              lendingRates: [{ rate: 0.0, lendingRateType: 'VARIABLE', additionalInfo: 'See Provider Website' }],
              depositRates: [],
              constraints: [],
              eligibility: []
            }
          }
          dispatch(conoutWarn(`Applying agnostic details fallback for CORS/Preflight blocked product: ${productId}`))
          return {idx: dataSourceIdx, response: stubbedDetail}
        }
        return {idx: dataSourceIdx, response: null}
      })
  })
}

export const retrieveAllProductDetails = (actions) => dispatch => dispatch({
  type: RETRIEVE_ALL_PRODUCT_DETAILS,
  payload: Promise.all(actions.map(action => dispatch(action)))
})

export const deleteData = (dataSourceIdx) => ({
  type: DELETE_DATA,
  payload: dataSourceIdx
})

export const clearData = (dataSourceIdx) => ({
  type: CLEAR_DATA,
  payload: dataSourceIdx
})
